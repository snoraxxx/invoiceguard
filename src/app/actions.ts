"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  goodsReceiptLines,
  goodsReceipts,
  inventoryItems,
  invoiceEvents,
  invoices,
  purchaseOrders,
  vendors,
} from "@/db";
import { matchVendor } from "@/lib/agent/checks";

export type ActionResult = { ok: true } | { ok: false; error: string };

const REVIEW_LABEL = { verified: "approved", rejected: "rejected", flagged: "sent back to review" } as const;

export async function reviewInvoice(
  id: string,
  decision: "verified" | "rejected" | "flagged",
  note: string,
): Promise<ActionResult> {
  const trimmed = note.trim();
  if (decision !== "flagged" && trimmed.length < 3) {
    return { ok: false, error: "Add a short note explaining the decision — it goes into the audit trail." };
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: decision, decidedBy: "user", updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning({ id: invoices.id });
  if (!updated) return { ok: false, error: "Invoice not found." };

  await db.insert(invoiceEvents).values({
    invoiceId: id,
    actor: "user",
    action: REVIEW_LABEL[decision],
    message: trimmed || null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addInvoiceNote(id: string, note: string): Promise<ActionResult> {
  if (!note.trim()) return { ok: false, error: "Note is empty." };
  await db.insert(invoiceEvents).values({ invoiceId: id, actor: "user", action: "note", message: note.trim() });
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

export async function deleteInvoice(id: string) {
  await db.delete(invoices).where(eq(invoices.id, id));
  revalidatePath("/", "layout");
  redirect("/invoices");
}

const optional = z
  .string()
  .trim()
  .transform((v) => v || null);

const VendorInput = z.object({
  name: z.string().trim().min(2, "Vendor name is required"),
  taxId: optional,
  email: optional.pipe(z.email("Invalid email").nullable()),
  address: optional,
  bankName: optional,
  bankAccount: optional,
  bankRouting: optional,
  notes: optional,
});

export async function saveVendor(id: string | null, formData: FormData): Promise<ActionResult> {
  const parsed = VendorInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (id) await db.update(vendors).set(parsed.data).where(eq(vendors.id, id));
  else await db.insert(vendors).values(parsed.data);
  revalidatePath("/vendors");
  return { ok: true };
}

export async function setVendorStatus(id: string, status: "active" | "blocked"): Promise<ActionResult> {
  await db.update(vendors).set({ status }).where(eq(vendors.id, id));
  revalidatePath("/vendors");
  return { ok: true };
}

const PurchaseOrderInput = z.object({
  poNumber: z.string().trim().min(2, "PO number is required"),
  vendorId: z.uuid("Choose a vendor"),
  description: optional,
  amount: z.coerce.number({ error: "Amount must be a number" }).positive("Amount must be greater than zero"),
  currency: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase(),
  issuedOn: z.iso.date("Pick an issue date"),
});

export async function createPurchaseOrder(formData: FormData): Promise<ActionResult> {
  const parsed = PurchaseOrderInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const [existing] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.poNumber, parsed.data.poNumber))
    .limit(1);
  if (existing) return { ok: false, error: `PO ${parsed.data.poNumber} already exists.` };
  await db.insert(purchaseOrders).values(parsed.data);
  revalidatePath("/purchase-orders");
  return { ok: true };
}

export async function setPurchaseOrderStatus(id: string, status: "open" | "closed"): Promise<ActionResult> {
  await db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, id));
  revalidatePath("/purchase-orders");
  return { ok: true };
}

const InventoryItemInput = z.object({
  sku: z
    .string()
    .trim()
    .min(2, "SKU is required")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, "Item name is required"),
  category: z.string().trim().min(2, "Category is required"),
  unit: z.string().trim().min(1, "Unit is required"),
  reorderLevel: z.coerce.number({ error: "Reorder level must be a number" }).min(0),
});

export async function createInventoryItem(formData: FormData): Promise<ActionResult> {
  const parsed = InventoryItemInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const [existing] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(eq(inventoryItems.sku, parsed.data.sku))
    .limit(1);
  if (existing) return { ok: false, error: `SKU ${parsed.data.sku} already exists.` };
  await db.insert(inventoryItems).values(parsed.data);
  revalidatePath("/inventory");
  return { ok: true };
}

const GoodsReceiptInput = z.object({
  grnNumber: z.string().trim().min(2, "GRN number is required"),
  supplierName: z.string().trim().min(2, "Supplier name is required"),
  supplierTaxId: optional,
  poNumber: optional,
  receivedOn: z.iso.date("Pick the date the goods arrived"),
  receivedBy: optional,
  notes: optional,
  lines: z
    .array(
      z.object({
        itemId: z.uuid("Choose an item for every line"),
        quantity: z.coerce.number({ error: "Quantity must be a number" }).positive("Quantities must be above zero"),
        unitCost: z.coerce.number({ error: "Unit cost must be a number" }).min(0, "Unit cost can't be negative"),
      }),
    )
    .min(1, "Add at least one item"),
});

export type GoodsReceiptForm = z.input<typeof GoodsReceiptInput>;

/** Log a delivery at the warehouse and add the goods to stock. */
export async function recordGoodsReceipt(input: GoodsReceiptForm): Promise<ActionResult> {
  const parsed = GoodsReceiptInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { lines, ...receipt } = parsed.data;

  const [existing] = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.grnNumber, receipt.grnNumber))
    .limit(1);
  if (existing) return { ok: false, error: `${receipt.grnNumber} has already been recorded.` };

  // Link to the registry only on an exact name or tax ID — never on a look-alike name.
  const { vendor, matchedBy } = matchVendor(await db.select().from(vendors), {
    vendorName: receipt.supplierName,
    vendorTaxId: receipt.supplierTaxId,
  });
  const vendorId = matchedBy === "similar name" ? null : (vendor?.id ?? null);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(goodsReceipts)
      .values({ ...receipt, vendorId })
      .returning({ id: goodsReceipts.id });
    await tx.insert(goodsReceiptLines).values(lines.map((l) => ({ ...l, receiptId: row.id })));
    for (const l of lines) {
      await tx
        .update(inventoryItems)
        .set({ quantityOnHand: sql`${inventoryItems.quantityOnHand} + ${l.quantity}` })
        .where(eq(inventoryItems.id, l.itemId));
    }
  });
  revalidatePath("/inventory");
  return { ok: true };
}
