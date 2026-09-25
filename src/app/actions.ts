"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, invoiceEvents, invoices, purchaseOrders, vendors } from "@/db";

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
