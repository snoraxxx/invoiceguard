import { and, eq, ne, sql } from "drizzle-orm";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { db, invoices, purchaseOrders, vendors, type PurchaseOrder, type Vendor } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { maskAccount, nameSimilarity, normalizeId } from "@/lib/match";
import type { CheckResult, LineItem, ReceiptMatch } from "@/lib/types";
import { goodsReceiptCheck, type GoodsCheckOutcome } from "./receipts";

/** Everything the rule engine needs to know about an invoice. */
export type InvoiceFacts = {
  id: string;
  fileSha256: string;
  isInvoice: boolean;
  documentType: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  vendorTaxId: string | null;
  bankAccount: string | null;
  bankRouting: string | null;
  poNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  lineItems: LineItem[];
};

export type CheckOutcome = {
  checks: CheckResult[];
  vendor: Vendor | null;
  purchaseOrder: PurchaseOrder | null;
  receiptMatch: ReceiptMatch | null;
  ruleScore: number;
};

const NAME_MATCH_THRESHOLD = 0.86;

const check = (
  id: CheckResult["id"],
  label: string,
  status: CheckResult["status"],
  detail: string,
  weight = 0,
): CheckResult => ({ id, label, status, detail, weight: status === "pass" || status === "skip" ? 0 : weight });

export async function runChecks(facts: InvoiceFacts): Promise<CheckOutcome> {
  const checks: CheckResult[] = [];

  // 1. Is this even an invoice?
  checks.push(
    facts.isInvoice
      ? check("document", "Document type", "pass", `Recognised as ${facts.documentType}.`)
      : check(
          "document",
          "Document type",
          "fail",
          `This does not look like an invoice (detected: ${facts.documentType}).`,
          80,
        ),
  );

  // 2. Vendor registry. A supplier we've never registered can still be authenticated by
  //    matching the invoice to goods the warehouse actually received from them.
  const allVendors = await db.select().from(vendors);
  const { vendor, matchedBy } = matchVendor(allVendors, facts);
  const goods = await goodsReceiptCheck({
    invoiceId: facts.id,
    invoiceDate: facts.invoiceDate,
    currency: facts.currency,
    subtotal: facts.subtotal,
    total: facts.total,
    lineItems: facts.lineItems,
    supplier: { vendor, name: facts.vendorName, taxId: facts.vendorTaxId },
  });
  if (!vendor) {
    checks.push(newSupplierCheck(allVendors, facts, goods));
  } else if (vendor.status === "blocked") {
    checks.push(check("vendor", "Approved vendor", "fail", `${vendor.name} is on the blocked vendor list.`, 80));
  } else if (matchedBy === "similar name") {
    checks.push(
      check(
        "vendor",
        "Approved vendor",
        "warn",
        `"${facts.vendorName}" closely resembles registered vendor ${vendor.name} but is not identical — confirm this is not an impersonation.`,
        20,
      ),
    );
  } else {
    checks.push(
      check("vendor", "Approved vendor", "pass", `Matched registered vendor ${vendor.name} by ${matchedBy}.`),
    );
  }

  // 3. Tax ID
  if (!vendor) {
    checks.push(check("tax_id", "Tax registration", "skip", "No registered vendor to compare against."));
  } else if (!facts.vendorTaxId) {
    checks.push(check("tax_id", "Tax registration", "warn", "No tax ID is printed on the invoice.", 10));
  } else if (!vendor.taxId) {
    checks.push(check("tax_id", "Tax registration", "skip", `No tax ID on file for ${vendor.name}.`));
  } else if (normalizeId(vendor.taxId) === normalizeId(facts.vendorTaxId)) {
    checks.push(check("tax_id", "Tax registration", "pass", `Tax ID ${facts.vendorTaxId} matches the registry.`));
  } else {
    checks.push(
      check(
        "tax_id",
        "Tax registration",
        "fail",
        `Invoice shows tax ID ${facts.vendorTaxId}, but ${vendor.name} is registered with ${vendor.taxId}.`,
        35,
      ),
    );
  }

  // 4. Bank details — the most common payment-diversion vector
  if (!vendor) {
    checks.push(check("bank", "Bank details", "skip", "No registered vendor to compare against."));
  } else if (!facts.bankAccount) {
    checks.push(check("bank", "Bank details", "skip", "No bank account printed on the invoice."));
  } else if (!vendor.bankAccount) {
    checks.push(
      check(
        "bank",
        "Bank details",
        "warn",
        `No bank account on file for ${vendor.name} — confirm by phone before paying.`,
        15,
      ),
    );
  } else if (normalizeId(vendor.bankAccount) !== normalizeId(facts.bankAccount)) {
    checks.push(
      check(
        "bank",
        "Bank details",
        "fail",
        `Invoice asks for payment to account ${maskAccount(facts.bankAccount)}, but the registered account is ${maskAccount(vendor.bankAccount)}. Changed bank details are the #1 invoice-fraud pattern.`,
        50,
      ),
    );
  } else if (
    vendor.bankRouting &&
    facts.bankRouting &&
    normalizeId(vendor.bankRouting) !== normalizeId(facts.bankRouting)
  ) {
    checks.push(
      check(
        "bank",
        "Bank details",
        "fail",
        `Account number matches but routing code ${facts.bankRouting} differs from the registered ${vendor.bankRouting}.`,
        35,
      ),
    );
  } else {
    checks.push(
      check("bank", "Bank details", "pass", `Account ${maskAccount(facts.bankAccount)} matches the registry.`),
    );
  }

  // 5. Duplicates
  checks.push(await duplicateCheck(facts, vendor));

  // 6. Arithmetic
  checks.push(arithmeticCheck(facts));

  // 7. Goods received
  checks.push(goods.result);

  // 8. Purchase order
  const { result: poResult, purchaseOrder } = await purchaseOrderCheck(facts, vendor, goods);
  checks.push(poResult);

  // 9. Dates
  checks.push(dateCheck(facts, purchaseOrder));

  const ruleScore = Math.min(
    100,
    checks.reduce((sum, c) => sum + c.weight, 0),
  );
  return { checks, vendor, purchaseOrder, receiptMatch: goods.match, ruleScore };
}

function newSupplierCheck(allVendors: Vendor[], facts: InvoiceFacts, goods: GoodsCheckOutcome): CheckResult {
  const label = "Approved vendor";
  const name = facts.vendorName ?? "Unknown vendor";
  const nearest = allVendors
    .map((v) => ({ v, score: nameSimilarity(v.name, facts.vendorName) }))
    .sort((a, b) => b.score - a.score)[0];
  const lookalike =
    nearest && nearest.score >= 0.6 ? ` Closest registered name is "${nearest.v.name}" — possible impersonation.` : "";

  if (goods.confirmed) {
    return check(
      "vendor",
      label,
      "warn",
      `"${name}" is a first-time supplier, not yet in the vendor registry. Their delivery is confirmed by ${goods.grnLabel}; register them and confirm their bank details by phone before the first payment.${lookalike}`,
      20,
    );
  }
  if (goods.result.status === "warn") {
    return check(
      "vendor",
      label,
      "warn",
      `"${name}" is a first-time supplier and their invoice only partly matches goods received on ${goods.grnLabel}.${lookalike}`,
      25,
    );
  }
  return check(
    "vendor",
    label,
    "fail",
    `"${name}" is not in the approved vendor registry, and ${
      goods.match
        ? "the invoice doesn't agree with the goods we received from them"
        : "there's no delivery from them to back the invoice"
    }.${lookalike}`,
    40,
  );
}

export function matchVendor(allVendors: Vendor[], facts: Pick<InvoiceFacts, "vendorName" | "vendorTaxId">) {
  const taxId = normalizeId(facts.vendorTaxId);
  if (taxId) {
    const byTax = allVendors.find((v) => v.taxId && normalizeId(v.taxId) === taxId);
    if (byTax) return { vendor: byTax, matchedBy: "tax ID" };
  }
  const byName = allVendors
    .map((v) => ({ v, score: nameSimilarity(v.name, facts.vendorName) }))
    .filter((x) => x.score >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)[0];
  if (byName) return { vendor: byName.v, matchedBy: byName.score === 1 ? "name" : "similar name" };
  return { vendor: null, matchedBy: null };
}

async function duplicateCheck(facts: InvoiceFacts, vendor: Vendor | null): Promise<CheckResult> {
  const others = and(ne(invoices.id, facts.id), ne(invoices.status, "failed"));

  const [sameFile] = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status })
    .from(invoices)
    .where(and(others, eq(invoices.fileSha256, facts.fileSha256)))
    .limit(1);
  if (sameFile) {
    return check(
      "duplicate",
      "Duplicate submission",
      "fail",
      `This exact file was already submitted${sameFile.invoiceNumber ? ` as ${sameFile.invoiceNumber}` : ""} (currently ${sameFile.status}).`,
      70,
    );
  }

  if (vendor && facts.invoiceNumber) {
    const [sameNumber] = await db
      .select({ id: invoices.id, status: invoices.status, total: invoices.total, currency: invoices.currency })
      .from(invoices)
      .where(
        and(
          others,
          eq(invoices.vendorId, vendor.id),
          sql`upper(regexp_replace(${invoices.invoiceNumber}, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeId(facts.invoiceNumber)}`,
        ),
      )
      .limit(1);
    if (sameNumber) {
      return check(
        "duplicate",
        "Duplicate submission",
        "fail",
        `${vendor.name} already billed invoice number ${facts.invoiceNumber} (${formatMoney(sameNumber.total, sameNumber.currency)}, ${sameNumber.status}).`,
        60,
      );
    }
  }

  if (vendor && facts.total != null && facts.invoiceDate) {
    const [similar] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          others,
          eq(invoices.vendorId, vendor.id),
          eq(invoices.total, facts.total),
          eq(invoices.invoiceDate, facts.invoiceDate),
        ),
      )
      .limit(1);
    if (similar) {
      return check(
        "duplicate",
        "Duplicate submission",
        "warn",
        `Same vendor, amount and date as invoice ${similar.invoiceNumber ?? "(unnumbered)"} — possible re-issued duplicate.`,
        25,
      );
    }
  }

  return check("duplicate", "Duplicate submission", "pass", "No earlier submission with this file, number or amount.");
}

function arithmeticCheck(facts: InvoiceFacts): CheckResult {
  const { total, subtotal, taxAmount, lineItems, currency } = facts;
  if (total == null)
    return check("arithmetic", "Totals add up", "warn", "No grand total could be read from the invoice.", 15);

  const tolerance = Math.max(1, Math.abs(total) * 0.005);
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const money = (n: number) => formatMoney(n, currency);
  const problems: string[] = [];

  for (const item of lineItems) {
    if (item.quantity != null && item.unitPrice != null && item.amount != null) {
      const expected = item.quantity * item.unitPrice;
      if (!close(expected, item.amount)) {
        problems.push(
          `"${item.description}": ${item.quantity} × ${money(item.unitPrice)} = ${money(expected)}, not ${money(item.amount)}`,
        );
      }
    }
  }

  const amounts = lineItems.map((i) => i.amount).filter((a): a is number => a != null);
  const lineSum = amounts.reduce((s, a) => s + a, 0);
  const expectedSubtotal = subtotal ?? (taxAmount != null ? total - taxAmount : null);
  if (
    amounts.length > 0 &&
    amounts.length === lineItems.length &&
    expectedSubtotal != null &&
    !close(lineSum, expectedSubtotal)
  ) {
    problems.push(`line items sum to ${money(lineSum)} but the subtotal is ${money(expectedSubtotal)}`);
  }
  if (subtotal != null && taxAmount != null && !close(subtotal + taxAmount, total)) {
    problems.push(
      `subtotal ${money(subtotal)} + tax ${money(taxAmount)} = ${money(subtotal + taxAmount)}, but the total says ${money(total)}`,
    );
  }
  if (subtotal != null && taxAmount != null && subtotal > 0 && taxAmount / subtotal > 0.3) {
    problems.push(`tax is ${Math.round((taxAmount / subtotal) * 100)}% of the subtotal, which is unusually high`);
  }

  if (problems.length > 0) {
    return check("arithmetic", "Totals add up", "fail", capitalize(problems.join("; ")) + ".", 30);
  }
  return check("arithmetic", "Totals add up", "pass", `Line items, tax and total reconcile to ${money(total)}.`);
}

async function purchaseOrderCheck(
  facts: InvoiceFacts,
  vendor: Vendor | null,
  goods: GoodsCheckOutcome,
): Promise<{ result: CheckResult; purchaseOrder: PurchaseOrder | null }> {
  const label = "Purchase order match";
  if (!facts.poNumber && goods.confirmed) {
    return {
      result: check(
        "purchase_order",
        label,
        "skip",
        `No PO quoted, but every line is backed by goods received on ${goods.grnLabel}.`,
      ),
      purchaseOrder: null,
    };
  }
  if (!facts.poNumber) {
    return {
      result: check("purchase_order", label, "warn", "No PO number quoted — non-PO invoices need manual sign-off.", 15),
      purchaseOrder: null,
    };
  }

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(
      sql`upper(regexp_replace(${purchaseOrders.poNumber}, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeId(facts.poNumber)}`,
    )
    .limit(1);
  if (!po) {
    return {
      result: check("purchase_order", label, "fail", `PO ${facts.poNumber} does not exist in the system.`, 35),
      purchaseOrder: null,
    };
  }
  if (vendor && po.vendorId !== vendor.id) {
    return {
      result: check("purchase_order", label, "fail", `PO ${po.poNumber} was issued to a different vendor.`, 40),
      purchaseOrder: po,
    };
  }
  if (po.status === "closed") {
    return { result: check("purchase_order", label, "fail", `PO ${po.poNumber} is closed.`, 30), purchaseOrder: po };
  }

  const billed = await billedAgainstPo(po.id, facts.id);
  const remaining = po.amount - billed;
  const money = (n: number) => formatMoney(n, po.currency);
  if (facts.currency && facts.currency !== po.currency) {
    return {
      result: check(
        "purchase_order",
        label,
        "warn",
        `Invoice is in ${facts.currency} but PO ${po.poNumber} is in ${po.currency}.`,
        15,
      ),
      purchaseOrder: po,
    };
  }
  if (facts.total != null && facts.total > remaining * 1.02 + 1) {
    return {
      result: check(
        "purchase_order",
        label,
        "fail",
        `Total ${money(facts.total)} exceeds the remaining PO balance of ${money(Math.max(0, remaining))} (${money(billed)} of ${money(po.amount)} already billed).`,
        30,
      ),
      purchaseOrder: po,
    };
  }
  return {
    result: check(
      "purchase_order",
      label,
      "pass",
      `Within PO ${po.poNumber}: ${money(Math.max(0, remaining))} of ${money(po.amount)} was available.`,
    ),
    purchaseOrder: po,
  };
}

export async function billedAgainstPo(poId: string, excludeInvoiceId?: string) {
  const [row] = await db
    .select({ billed: sql<string>`coalesce(sum(${invoices.total}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.purchaseOrderId, poId),
        eq(invoices.status, "verified"),
        excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined,
      ),
    );
  return Number(row?.billed ?? 0);
}

function dateCheck(facts: InvoiceFacts, po: PurchaseOrder | null): CheckResult {
  const label = "Dates are plausible";
  if (!facts.invoiceDate) return check("dates", label, "warn", "No invoice date could be read.", 10);

  const invoiceDate = parseISO(facts.invoiceDate);
  const age = differenceInCalendarDays(new Date(), invoiceDate);
  if (age < -1) {
    return check(
      "dates",
      label,
      "fail",
      `Invoice is dated ${formatDate(facts.invoiceDate)}, which is in the future.`,
      25,
    );
  }

  const warnings: string[] = [];
  if (age > 365) warnings.push(`invoice is ${Math.floor(age / 30)} months old`);
  if (facts.dueDate && differenceInCalendarDays(parseISO(facts.dueDate), invoiceDate) < 0) {
    warnings.push("due date is before the invoice date");
  }
  if (po && differenceInCalendarDays(invoiceDate, parseISO(po.issuedOn)) < 0) {
    warnings.push(`invoice predates PO ${po.poNumber} (${formatDate(po.issuedOn)})`);
  }

  if (warnings.length > 0) return check("dates", label, "warn", capitalize(warnings.join("; ")) + ".", 10);
  return check(
    "dates",
    label,
    "pass",
    `Issued ${formatDate(facts.invoiceDate)}${facts.dueDate ? `, due ${formatDate(facts.dueDate)}` : ""}.`,
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
