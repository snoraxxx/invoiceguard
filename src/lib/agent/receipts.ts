import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { addDays, format, parseISO, subDays } from "date-fns";
import {
  db,
  goodsReceiptLines,
  goodsReceipts,
  inventoryItems,
  invoices,
  type GoodsReceipt,
  type InventoryItem,
  type Vendor,
} from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { nameSimilarity, normalizeId, productSimilarity } from "@/lib/match";
import type { CheckResult, LineItem, ReceiptLineMatch, ReceiptMatch } from "@/lib/types";

/** Deliveries this long before the invoice date (or a few days after) can be billed by it. */
const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 7;
const SUPPLIER_NAME_THRESHOLD = 0.86;
const LINE_MATCH_THRESHOLD = 0.55;
const PRICE_TOLERANCE = 0.05;
/** Unmatched lines worth less than this share of the invoice (freight, handling) only warn. */
const MINOR_UNMATCHED_SHARE = 0.05;

export type Supplier = { vendor: Vendor | null; name: string | null; taxId: string | null };

export type ReceiptWithLines = GoodsReceipt & {
  lines: { itemId: string; item: InventoryItem; quantity: number; unitCost: number }[];
};

type Claim = { invoiceId: string; invoiceNumber: string | null; status: string };

/** Receipts already billed by another verified or pending-review invoice. */
export async function claimedReceipts(excludeInvoiceId?: string) {
  const rows = await db.execute<{
    receipt_id: string;
    invoice_id: string;
    invoice_number: string | null;
    status: string;
  }>(sql`
    select r->>'id' as receipt_id, i.id as invoice_id, i.invoice_number, i.status
    from ${invoices} i, jsonb_array_elements(i.receipt_match->'receipts') r
    where i.status in ('verified', 'flagged')
    ${excludeInvoiceId ? sql`and i.id <> ${excludeInvoiceId}` : sql``}
  `);
  const claims = new Map<string, Claim>();
  for (const row of rows) {
    claims.set(row.receipt_id, { invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, status: row.status });
  }
  return claims;
}

export async function loadReceipts(filter: { from?: string; to?: string; ids?: string[] } = {}) {
  const receipts = await db
    .select()
    .from(goodsReceipts)
    .where(
      and(
        filter.from ? gte(goodsReceipts.receivedOn, filter.from) : undefined,
        filter.to ? lte(goodsReceipts.receivedOn, filter.to) : undefined,
        filter.ids ? inArray(goodsReceipts.id, filter.ids) : undefined,
      ),
    )
    .orderBy(asc(goodsReceipts.receivedOn));
  if (receipts.length === 0) return [];

  const lines = await db
    .select({ line: goodsReceiptLines, item: inventoryItems })
    .from(goodsReceiptLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, goodsReceiptLines.itemId))
    .where(
      inArray(
        goodsReceiptLines.receiptId,
        receipts.map((r) => r.id),
      ),
    );
  return receipts.map((r): ReceiptWithLines => ({
    ...r,
    lines: lines
      .filter((l) => l.line.receiptId === r.id)
      .map((l) => ({ itemId: l.item.id, item: l.item, quantity: l.line.quantity, unitCost: l.line.unitCost })),
  }));
}

/**
 * Was this receipt delivered by the invoicing supplier? A tax ID match is conclusive; a name match
 * with a different tax ID on record is a conflict worth calling out.
 */
export function receiptSupplierMatch(receipt: GoodsReceipt, supplier: Supplier): "yes" | "no" | "tax_conflict" {
  if (supplier.vendor && receipt.vendorId === supplier.vendor.id) return "yes";
  const taxId = normalizeId(supplier.taxId ?? supplier.vendor?.taxId);
  const receiptTaxId = normalizeId(receipt.supplierTaxId);
  if (taxId && receiptTaxId && taxId === receiptTaxId) return "yes";
  const similar =
    nameSimilarity(receipt.supplierName, supplier.name) >= SUPPLIER_NAME_THRESHOLD ||
    (supplier.vendor != null && nameSimilarity(receipt.supplierName, supplier.vendor.name) >= SUPPLIER_NAME_THRESHOLD);
  if (!similar) return "no";
  return taxId && receiptTaxId ? "tax_conflict" : "yes";
}

/** Goods received from this supplier, oldest first. */
export async function supplierReceipts(supplier: Supplier, around?: string | null) {
  const anchor = around ? parseISO(around) : new Date();
  const all = await loadReceipts({
    from: format(subDays(anchor, LOOKBACK_DAYS), "yyyy-MM-dd"),
    to: format(addDays(anchor, LOOKAHEAD_DAYS), "yyyy-MM-dd"),
  });
  const matched: ReceiptWithLines[] = [];
  const conflicts: ReceiptWithLines[] = [];
  for (const r of all) {
    const m = receiptSupplierMatch(r, supplier);
    if (m === "yes") matched.push(r);
    else if (m === "tax_conflict") conflicts.push(r);
  }
  return { matched, conflicts };
}

type GoodsCheckInput = {
  invoiceId: string;
  invoiceDate: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  lineItems: LineItem[];
  supplier: Supplier;
};

export type GoodsCheckOutcome = {
  result: CheckResult;
  match: ReceiptMatch | null;
  /** True when the invoice is fully backed by goods we received. */
  confirmed: boolean;
  grnLabel: string | null;
};

const LABEL = "Goods received";

export async function goodsReceiptCheck(input: GoodsCheckInput): Promise<GoodsCheckOutcome> {
  const { supplier } = input;
  const isNew = !supplier.vendor;
  const who = supplier.vendor?.name ?? supplier.name ?? "this supplier";
  const result = (status: CheckResult["status"], detail: string, weight = 0): CheckResult => ({
    id: "goods_receipt",
    label: LABEL,
    status,
    detail,
    weight: status === "pass" || status === "skip" ? 0 : weight,
  });
  const none = (r: CheckResult): GoodsCheckOutcome => ({ result: r, match: null, confirmed: false, grnLabel: null });

  const { matched, conflicts } = await supplierReceipts(supplier, input.invoiceDate);

  if (matched.length === 0) {
    if (conflicts.length > 0) {
      const c = conflicts[conflicts.length - 1];
      return none(
        result(
          "fail",
          `Goods from "${c.supplierName}" were received on ${c.grnNumber} under tax ID ${c.supplierTaxId}, but this invoice carries ${supplier.taxId}. The invoice may not come from the supplier who delivered.`,
          45,
        ),
      );
    }
    if (isNew) {
      return none(
        result(
          "fail",
          `No goods have been received from ${who} in the last ${LOOKBACK_DAYS} days. A first-time supplier can only be paid for goods we can show we received.`,
          45,
        ),
      );
    }
    return none(result("skip", `No goods receipts on file for ${who} — matched against the purchase order instead.`));
  }

  const claims = await claimedReceipts(input.invoiceId);
  const open = matched.filter((r) => !claims.has(r.id));
  if (open.length === 0) {
    const last = matched[matched.length - 1];
    const claim = claims.get(last.id)!;
    return none(
      result(
        "fail",
        `Every delivery from ${who} has already been billed — ${last.grnNumber} is covered by invoice ${claim.invoiceNumber ?? "(unnumbered)"}, which is ${claim.status === "verified" ? "verified" : "awaiting review"}.`,
        isNew ? 55 : 40,
      ),
    );
  }

  if (input.lineItems.length === 0) {
    return none(result("warn", "The invoice has no line items to match against deliveries.", 15));
  }

  // Pool open received quantities per inventory item across deliveries.
  const pool = new Map<
    string,
    { item: InventoryItem; received: number; remaining: number; cost: number; receiptIds: Set<string> }
  >();
  for (const r of open) {
    for (const l of r.lines) {
      const entry = pool.get(l.itemId) ?? {
        item: l.item,
        received: 0,
        remaining: 0,
        cost: 0,
        receiptIds: new Set<string>(),
      };
      // Weighted average cost across deliveries.
      entry.cost = (entry.cost * entry.received + l.unitCost * l.quantity) / (entry.received + l.quantity);
      entry.received += l.quantity;
      entry.remaining += l.quantity;
      entry.receiptIds.add(r.id);
      pool.set(l.itemId, entry);
    }
  }

  const used = new Set<string>();
  const lines: ReceiptLineMatch[] = input.lineItems.map((line) => {
    const best = [...pool.values()]
      .map((p) => ({ p, score: productSimilarity(line.description, p.item) + corroboration(line, p) }))
      .sort((a, b) => b.score - a.score)[0];
    const base = {
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    };
    if (!best || best.score < LINE_MATCH_THRESHOLD) {
      return { ...base, item: null, receivedQuantity: null, receivedUnitCost: null, status: "not_received" };
    }
    const { p } = best;
    p.receiptIds.forEach((id) => used.add(id));
    const available = p.remaining;
    p.remaining = Math.max(0, p.remaining - (line.quantity ?? 0));
    const status: ReceiptLineMatch["status"] =
      line.quantity != null && line.quantity > available + 1e-6
        ? "over_quantity"
        : line.unitPrice != null && line.unitPrice > p.cost * (1 + PRICE_TOLERANCE) + 0.01
          ? "price_mismatch"
          : "matched";
    return {
      ...base,
      item: { sku: p.item.sku, name: p.item.name, unit: p.item.unit },
      receivedQuantity: available,
      receivedUnitCost: Math.round(p.cost * 100) / 100,
      status,
    };
  });

  const usedReceipts = open.filter((r) => used.has(r.id));
  const match: ReceiptMatch = {
    receipts: usedReceipts.map((r) => ({ id: r.id, grnNumber: r.grnNumber, receivedOn: r.receivedOn })),
    lines,
  };
  const grnLabel = usedReceipts.map((r) => r.grnNumber).join(", ") || null;
  const money = (n: number) => formatMoney(n, input.currency);

  const notReceived = lines.filter((l) => l.status === "not_received");
  const over = lines.filter((l) => l.status === "over_quantity");
  const pricey = lines.filter((l) => l.status === "price_mismatch");
  const lineValue = (l: ReceiptLineMatch) => Math.abs(l.amount ?? (l.quantity ?? 0) * (l.unitPrice ?? 0));
  const base = input.subtotal ?? input.total ?? lines.reduce((s, l) => s + lineValue(l), 0);
  const unmatchedShare = base > 0 ? notReceived.reduce((s, l) => s + lineValue(l), 0) / base : 1;

  const problems = [
    ...over.map(
      (l) =>
        `"${l.description}" bills ${l.quantity} ${l.item!.unit} but only ${l.receivedQuantity} ${l.receivedQuantity === 1 ? "was" : "were"} received`,
    ),
    ...notReceived.map((l) => `"${l.description}" was never received`),
    ...pricey.map(
      (l) =>
        `"${l.description}" is billed at ${money(l.unitPrice!)} vs ${money(l.receivedUnitCost!)} recorded on delivery`,
    ),
  ];
  const summary = problems.slice(0, 3).join("; ") + (problems.length > 3 ? `; and ${problems.length - 3} more` : "");

  if (over.length > 0 || (notReceived.length > 0 && unmatchedShare > MINOR_UNMATCHED_SHARE)) {
    return {
      result: result("fail", `Billing for goods we didn't receive: ${summary}.`, isNew ? 50 : 40),
      match,
      confirmed: false,
      grnLabel,
    };
  }
  if (pricey.length > 0 || notReceived.length > 0) {
    return { result: result("warn", `${capitalize(summary)}.`, 15), match, confirmed: false, grnLabel };
  }

  const dates = usedReceipts.map((r) => formatDate(r.receivedOn)).join(", ");
  return {
    result: result(
      "pass",
      `All ${lines.length} line${lines.length === 1 ? "" : "s"} match goods received on ${grnLabel} (${dates}) — quantities and prices agree.`,
    ),
    match,
    confirmed: true,
    grnLabel,
  };
}

/**
 * Invoices abbreviate ("MCB 32A SP" for "MCB 32A single pole"). When the quantity and unit price
 * both agree with a delivery, that's strong supporting evidence — but never enough on its own.
 */
function corroboration(line: LineItem, delivered: { remaining: number; cost: number }) {
  const sameQuantity = line.quantity != null && Math.abs(line.quantity - delivered.remaining) < 1e-6;
  const samePrice = line.unitPrice != null && Math.abs(line.unitPrice - delivered.cost) <= delivered.cost * 0.01;
  return sameQuantity && samePrice ? 0.25 : 0;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact view of a supplier's deliveries for the review agent. */
export async function describeSupplierReceipts(supplier: Supplier, excludeInvoiceId?: string) {
  const [{ matched, conflicts }, claims] = await Promise.all([
    supplierReceipts(supplier),
    claimedReceipts(excludeInvoiceId),
  ]);
  const view = (r: ReceiptWithLines) => ({
    grn_number: r.grnNumber,
    supplier_name: r.supplierName,
    supplier_tax_id: r.supplierTaxId,
    received_on: r.receivedOn,
    po_number: r.poNumber,
    billed_by_invoice: claims.get(r.id)?.invoiceNumber ?? null,
    lines: r.lines.map((l) => ({
      sku: l.item.sku,
      item: l.item.name,
      quantity: l.quantity,
      unit: l.item.unit,
      unit_cost: l.unitCost,
    })),
  });
  return {
    deliveries: matched.map(view),
    same_name_different_tax_id: conflicts.map(view),
  };
}
