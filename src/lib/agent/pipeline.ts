import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, invoiceEvents, invoiceFiles, invoices } from "@/db";
import { formatMoney } from "@/lib/format";
import type { AgentStep, AnalysisEvent, CheckResult } from "@/lib/types";
import { runChecks, type InvoiceFacts } from "./checks";
import { extractInvoice } from "./extract";
import { MODEL } from "./openai";
import { reviewInvoice, toFindings } from "./review";

export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

type Emit = (event: AnalysisEvent) => void;

export async function createInvoiceFromUpload(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: unsupported file type. Upload a PDF, PNG, JPG or WebP.`);
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: file is larger than 15 MB.`);

  const data = Buffer.from(await file.arrayBuffer());
  const sha = createHash("sha256").update(data).digest("hex");

  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoices)
      .values({ fileName: file.name, mimeType: file.type, fileSize: file.size, fileSha256: sha })
      .returning({ id: invoices.id });
    await tx.insert(invoiceFiles).values({ invoiceId: invoice.id, data });
    await tx
      .insert(invoiceEvents)
      .values({ invoiceId: invoice.id, actor: "user", action: "uploaded", message: file.name });
    return invoice.id;
  });
}

/** Decide the outcome from rule checks and the agent's own score. The stricter signal always wins. */
export function decide(checks: CheckResult[], ruleScore: number, agentScore: number | null) {
  const riskScore = Math.max(ruleScore, agentScore ?? 0);
  const hardFail = checks.some((c) => c.status === "fail" && c.weight >= 60);
  const anyFail = checks.some((c) => c.status === "fail");
  let status: "verified" | "flagged" | "rejected";
  if (hardFail || riskScore >= 70) status = "rejected";
  else if (anyFail || riskScore >= 30) status = "flagged";
  else status = "verified";
  return { status, riskScore: hardFail ? Math.max(riskScore, 70) : anyFail ? Math.max(riskScore, 30) : riskScore };
}

export async function analyzeInvoice(invoiceId: string, emit: Emit) {
  const [row] = await db
    .select({ invoice: invoices, data: invoiceFiles.data })
    .from(invoices)
    .innerJoin(invoiceFiles, eq(invoiceFiles.invoiceId, invoices.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row) throw new Error("Invoice not found");
  const { invoice } = row;

  await db
    .update(invoices)
    .set({ status: "processing", error: null, decidedBy: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  try {
    // 1. Read the document
    emit({ type: "stage", stage: "extract", state: "running" });
    const extraction = await extractInvoice({ data: row.data, mimeType: invoice.mimeType, fileName: invoice.fileName });
    const lineItems = extraction.line_items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      amount: i.amount,
    }));
    await db
      .update(invoices)
      .set({
        invoiceNumber: extraction.invoice_number,
        vendorName: extraction.vendor_name,
        vendorTaxId: extraction.vendor_tax_id,
        vendorEmail: extraction.vendor_email,
        vendorAddress: extraction.vendor_address,
        bankName: extraction.bank_name,
        bankAccount: extraction.bank_account,
        bankRouting: extraction.bank_routing,
        poNumber: extraction.po_number,
        invoiceDate: extraction.invoice_date,
        dueDate: extraction.due_date,
        currency: extraction.currency,
        subtotal: extraction.subtotal,
        taxAmount: extraction.tax_amount,
        total: extraction.total,
        lineItems,
      })
      .where(eq(invoices.id, invoiceId));
    emit({
      type: "stage",
      stage: "extract",
      state: "done",
      detail: extraction.is_invoice
        ? `${extraction.invoice_number ?? "Unnumbered invoice"} from ${extraction.vendor_name ?? "unknown vendor"} · ${formatMoney(extraction.total, extraction.currency)}`
        : `Looks like a ${extraction.document_type}, not an invoice`,
    });

    // 2. Deterministic checks
    emit({ type: "stage", stage: "checks", state: "running" });
    const facts: InvoiceFacts = {
      id: invoiceId,
      fileSha256: invoice.fileSha256,
      isInvoice: extraction.is_invoice,
      documentType: extraction.document_type,
      invoiceNumber: extraction.invoice_number,
      vendorName: extraction.vendor_name,
      vendorTaxId: extraction.vendor_tax_id,
      bankAccount: extraction.bank_account,
      bankRouting: extraction.bank_routing,
      poNumber: extraction.po_number,
      invoiceDate: extraction.invoice_date,
      dueDate: extraction.due_date,
      currency: extraction.currency,
      subtotal: extraction.subtotal,
      taxAmount: extraction.tax_amount,
      total: extraction.total,
      lineItems,
    };
    const { checks, vendor, purchaseOrder, ruleScore } = await runChecks(facts);
    for (const check of checks) emit({ type: "check", check });
    const failed = checks.filter((c) => c.status === "fail").length;
    const warned = checks.filter((c) => c.status === "warn").length;
    emit({
      type: "stage",
      stage: "checks",
      state: "done",
      detail: failed + warned === 0 ? "All checks passed" : `${failed} failed · ${warned} warnings`,
    });

    // 3. Agent investigation
    emit({ type: "stage", stage: "review", state: "running" });
    const steps: AgentStep[] = [];
    const review = await reviewInvoice({ extraction, checks, vendorId: vendor?.id ?? null, ruleScore }, (step) => {
      steps.push(step);
      emit({ type: "tool", name: step.name, summary: describeTool(step) });
    });
    emit({ type: "stage", stage: "review", state: "done", detail: `Agent verdict: ${review.verdict}` });

    // 4. Decision
    emit({ type: "stage", stage: "decision", state: "running" });
    const { status, riskScore } = decide(checks, ruleScore, review.risk_score);
    await db
      .update(invoices)
      .set({
        status,
        riskScore,
        decidedBy: "agent",
        vendorId: vendor?.id ?? null,
        purchaseOrderId: purchaseOrder?.id ?? null,
        checks,
        findings: toFindings(review),
        agentSteps: steps,
        summary: review.summary,
        model: MODEL,
        analyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));
    await db.insert(invoiceEvents).values({
      invoiceId,
      actor: "agent",
      action: status,
      message: `Risk ${riskScore}/100. ${review.summary}`,
    });
    emit({ type: "stage", stage: "decision", state: "done", detail: status });
    emit({ type: "result", invoiceId, status, riskScore, summary: review.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    await db
      .update(invoices)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await db.insert(invoiceEvents).values({ invoiceId, actor: "system", action: "failed", message });
    emit({ type: "error", message, invoiceId });
  }
}

function describeTool(step: AgentStep) {
  const args = (step.input ?? {}) as Record<string, unknown>;
  switch (step.name) {
    case "search_vendors":
      return `Searched the vendor registry for “${args.query}”`;
    case "get_vendor_profile":
      return "Pulled the registered vendor profile";
    case "get_vendor_invoice_history":
      return "Compared against the vendor's invoice history";
    case "get_purchase_order":
      return `Looked up purchase order ${args.po_number}`;
    default:
      return step.name;
  }
}
