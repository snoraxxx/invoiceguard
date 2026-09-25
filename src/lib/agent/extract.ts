import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { getOpenAI, MODEL, REASONING_EFFORT } from "./openai";

const money = z.number().nullable();
const text = z.string().nullable();

export const ExtractionSchema = z.object({
  is_invoice: z
    .boolean()
    .describe("True only if the document is a bill/invoice requesting payment for goods or services."),
  document_type: z.string().describe("Short label, e.g. 'tax invoice', 'receipt', 'quotation', 'bank statement'."),
  invoice_number: text,
  vendor_name: text.describe("The seller / supplier issuing the invoice, not the buyer."),
  vendor_tax_id: text.describe("Seller's tax registration (GSTIN, VAT, EIN, ABN...). Exactly as printed."),
  vendor_email: text,
  vendor_address: text,
  bank_name: text,
  bank_account: text.describe("Account number or IBAN the payment should go to, exactly as printed."),
  bank_routing: text.describe("IFSC, SWIFT/BIC, sort code or routing number."),
  po_number: text.describe("Purchase order reference quoted on the invoice."),
  invoice_date: text.describe("ISO date YYYY-MM-DD."),
  due_date: text.describe("ISO date YYYY-MM-DD."),
  currency: text.describe("ISO 4217 code, e.g. INR, USD, EUR."),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: money,
      unit_price: money,
      amount: money,
    }),
  ),
  subtotal: money,
  tax_amount: money.describe("Sum of all taxes (GST/VAT/sales tax)."),
  total: money.describe("Grand total payable."),
  remarks: text.describe(
    "Any notes, payment instructions or free text on the document, verbatim (e.g. 'please note our new bank details').",
  ),
  forensic_observations: z
    .array(
      z.object({
        severity: z.enum(["low", "medium", "high"]),
        observation: z.string(),
      }),
    )
    .describe(
      "Visual or textual signs of tampering or forgery. Empty array if the document looks clean. Do not speculate.",
    ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const INSTRUCTIONS = `You are a meticulous accounts-payable document analyst.
Read the attached document and extract its fields exactly as printed. Rules:
- Never invent values. Use null when a field is absent or illegible.
- Amounts are plain numbers without currency symbols or thousands separators.
- Dates must be converted to YYYY-MM-DD. If the day/month order is ambiguous, prefer the convention implied by the currency/country.
- The vendor is the party issuing the invoice and receiving payment, never the "Bill to" party.
- In forensic_observations, report only concrete evidence of manipulation: mismatched fonts or alignment in key fields,
  overwritten or pasted-over numbers, inconsistent totals, low-resolution or distorted logos, edits to bank details,
  pressure language ("urgent", "pay today", "updated bank account"). A normal document should produce an empty array.`;

export async function extractInvoice(file: { data: Buffer; mimeType: string; fileName: string }) {
  const base64 = file.data.toString("base64");
  const document: ResponseInputContent =
    file.mimeType === "application/pdf"
      ? { type: "input_file", filename: file.fileName, file_data: `data:application/pdf;base64,${base64}` }
      : { type: "input_image", image_url: `data:${file.mimeType};base64,${base64}`, detail: "high" };

  const response = await getOpenAI().responses.parse({
    model: MODEL,
    reasoning: { effort: REASONING_EFFORT },
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [document, { type: "input_text", text: "Extract this document." }],
      },
    ],
    text: { format: zodTextFormat(ExtractionSchema, "invoice_extraction") },
  });

  if (!response.output_parsed) throw new Error("The model did not return a readable extraction.");
  return normalizeExtraction(response.output_parsed);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeExtraction(e: Extraction): Extraction {
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const date = (v: string | null) => (v && ISO_DATE.test(v.trim()) && !Number.isNaN(Date.parse(v)) ? v.trim() : null);
  return {
    ...e,
    invoice_number: clean(e.invoice_number),
    vendor_name: clean(e.vendor_name),
    vendor_tax_id: clean(e.vendor_tax_id),
    vendor_email: clean(e.vendor_email),
    vendor_address: clean(e.vendor_address),
    bank_name: clean(e.bank_name),
    bank_account: clean(e.bank_account),
    bank_routing: clean(e.bank_routing),
    po_number: clean(e.po_number),
    invoice_date: date(e.invoice_date),
    due_date: date(e.due_date),
    currency: clean(e.currency)?.toUpperCase() ?? null,
    remarks: clean(e.remarks),
  };
}
