import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { db, invoices, purchaseOrders, vendors } from "@/db";
import { nameSimilarity, normalizeId } from "@/lib/match";
import type { AgentStep, CheckResult, Finding, ReceiptMatch } from "@/lib/types";
import { billedAgainstPo, matchVendor } from "./checks";
import type { Extraction } from "./extract";
import { getOpenAI, MODEL, REASONING_EFFORT } from "./openai";
import { describeSupplierReceipts } from "./receipts";

const MAX_TOOL_ROUNDS = 6;

export const ReviewSchema = z.object({
  verdict: z.enum(["authentic", "suspicious", "fraudulent"]),
  risk_score: z.number().describe("0 = certainly genuine, 100 = certainly fraudulent."),
  summary: z.string().describe("Two or three plain sentences for an AP clerk: what you concluded and why."),
  findings: z.array(
    z.object({
      severity: z.enum(["info", "low", "medium", "high", "critical"]),
      title: z.string().describe("Short headline, under 8 words."),
      detail: z.string(),
    }),
  ),
});

export type Review = z.infer<typeof ReviewSchema>;

const tools = [
  zodResponsesFunction({
    name: "search_vendors",
    description:
      "Fuzzy-search the approved vendor registry by name. Use it to spot look-alike vendor names (impersonation) or find the real vendor.",
    parameters: z.object({ query: z.string() }),
  }),
  zodResponsesFunction({
    name: "get_vendor_profile",
    description: "Full registry record for a vendor: tax ID, registered bank details, contact email, status and notes.",
    parameters: z.object({ vendor_id: z.string() }),
  }),
  zodResponsesFunction({
    name: "get_vendor_invoice_history",
    description:
      "The vendor's most recent invoices (number, date, total, status). Use it to judge whether amount, numbering and cadence are normal.",
    parameters: z.object({ vendor_id: z.string(), limit: z.number().describe("1-20") }),
  }),
  zodResponsesFunction({
    name: "get_purchase_order",
    description: "Look up a purchase order by number, including the amount already billed against it.",
    parameters: z.object({ po_number: z.string() }),
  }),
  zodResponsesFunction({
    name: "get_goods_receipts",
    description:
      "Deliveries the warehouse logged from a supplier in the last 6 months (goods received notes): items, quantities, unit costs, the tax ID recorded at delivery, and whether each delivery is already billed. Works for suppliers that are not in the vendor registry.",
    parameters: z.object({
      supplier_name: z.string(),
      supplier_tax_id: z.string().nullable().describe("Tax ID printed on the invoice, if any."),
    }),
  }),
];

type ToolName = (typeof tools)[number]["name"];

async function runTool(name: ToolName | string, args: Record<string, unknown>, invoiceId: string): Promise<unknown> {
  switch (name) {
    case "search_vendors": {
      const all = await db.select().from(vendors);
      return all
        .map((v) => ({
          id: v.id,
          name: v.name,
          status: v.status,
          similarity: Number(nameSimilarity(v.name, String(args.query)).toFixed(2)),
        }))
        .filter((v) => v.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
    }
    case "get_vendor_profile": {
      const [v] = await db
        .select()
        .from(vendors)
        .where(eq(vendors.id, String(args.vendor_id)))
        .limit(1);
      if (!v) return { error: "Vendor not found" };
      const [stats] = await db
        .select({ count: sql<number>`count(*)::int`, first: sql<string | null>`min(${invoices.invoiceDate})::text` })
        .from(invoices)
        .where(eq(invoices.vendorId, v.id));
      return { ...v, invoices_on_record: stats?.count ?? 0, first_invoice_date: stats?.first ?? null };
    }
    case "get_vendor_invoice_history": {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
      return db
        .select({
          invoice_number: invoices.invoiceNumber,
          invoice_date: invoices.invoiceDate,
          total: invoices.total,
          currency: invoices.currency,
          status: invoices.status,
          bank_account: invoices.bankAccount,
        })
        .from(invoices)
        .where(eq(invoices.vendorId, String(args.vendor_id)))
        .orderBy(desc(invoices.invoiceDate))
        .limit(limit);
    }
    case "get_purchase_order": {
      const [po] = await db
        .select({
          id: purchaseOrders.id,
          po_number: purchaseOrders.poNumber,
          vendor: vendors.name,
          vendor_id: vendors.id,
          description: purchaseOrders.description,
          amount: purchaseOrders.amount,
          currency: purchaseOrders.currency,
          issued_on: purchaseOrders.issuedOn,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
        .where(
          sql`upper(regexp_replace(${purchaseOrders.poNumber}, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeId(String(args.po_number))}`,
        )
        .limit(1);
      if (!po) return { error: "No purchase order with that number" };
      return { ...po, billed_so_far: await billedAgainstPo(po.id) };
    }
    case "get_goods_receipts": {
      const name = String(args.supplier_name ?? "");
      const taxId = args.supplier_tax_id ? String(args.supplier_tax_id) : null;
      const { vendor } = matchVendor(await db.select().from(vendors), { vendorName: name, vendorTaxId: taxId });
      return describeSupplierReceipts({ vendor, name, taxId }, invoiceId);
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const INSTRUCTIONS = `You are an accounts-payable fraud auditor for a procurement team. An invoice has been read by a document
analyst and run through deterministic rule checks. Decide whether it is safe to pay.

How to work:
1. Treat the rule check results as established facts. Do not contradict them; build on them.
2. Use your tools to investigate before concluding — typically: confirm the vendor profile, compare this invoice against the
   vendor's history (amount spikes, out-of-sequence numbering, bank account changes), and look for look-alike vendors
   when the vendor is unknown.
3. Weigh known fraud patterns: changed bank details, vendor impersonation / look-alike names, duplicate or split billing,
   inflated or round-number totals, invoices far above historical norms, missing or mismatched POs, pressure language,
   and visual tampering noted by the document analyst.
   For a first-time supplier (not in the registry) the strongest evidence is whether we actually received what they bill:
   check get_goods_receipts. Goods received that match the invoice line by line make the invoice credible; billing for
   goods never delivered, more units than delivered, or a tax ID that differs from the one recorded at delivery is a
   serious red flag. Even when it matches, remind the reviewer to register the supplier and confirm bank details.
4. Calibrate risk_score: 0-29 genuine and routine; 30-69 needs a human to confirm something specific; 70-100 likely fraud
   or must not be paid. Any failed rule check means the score should be at least 30.
5. Findings must be specific and actionable ("Call the vendor on their registered number to confirm the new account"),
   never generic. Include positive evidence as 'info' findings when it matters. Do not repeat every rule check verbatim.`;

export async function reviewInvoice(
  input: {
    invoiceId: string;
    extraction: Extraction;
    checks: CheckResult[];
    vendorId: string | null;
    receiptMatch: ReceiptMatch | null;
    ruleScore: number;
  },
  onStep: (step: AgentStep) => void,
): Promise<Review> {
  const openai = getOpenAI();
  const context = {
    extracted_invoice: input.extraction,
    matched_vendor_id: input.vendorId,
    goods_received_match: input.receiptMatch,
    rule_checks: input.checks.map(({ label, status, detail }) => ({ label, status, detail })),
    rule_risk_score: input.ruleScore,
    today: new Date().toISOString().slice(0, 10),
  };

  let response = await openai.responses.parse({
    model: MODEL,
    reasoning: { effort: REASONING_EFFORT },
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content: `Review this invoice.\n\n${JSON.stringify(context, null, 2)}` }],
    tools,
    text: { format: zodTextFormat(ReviewSchema, "invoice_review") },
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) break;

    const outputs: ResponseInputItem[] = [];
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        // leave args empty; the tool will report the problem back to the model
      }
      const result = await runTool(call.name, args, input.invoiceId).catch((e: Error) => ({ error: e.message }));
      const output = JSON.stringify(result);
      onStep({
        kind: "tool",
        name: call.name,
        input: args,
        output: truncate(output, 2000),
        at: new Date().toISOString(),
      });
      outputs.push({ type: "function_call_output", call_id: call.call_id, output });
    }

    const lastRound = round === MAX_TOOL_ROUNDS - 1;
    response = await openai.responses.parse({
      model: MODEL,
      reasoning: { effort: REASONING_EFFORT },
      instructions: INSTRUCTIONS,
      previous_response_id: response.id,
      input: outputs,
      tools,
      tool_choice: lastRound ? "none" : "auto",
      text: { format: zodTextFormat(ReviewSchema, "invoice_review") },
    });
  }

  const review = response.output_parsed;
  if (!review) throw new Error("The review agent did not return a verdict.");
  return { ...review, risk_score: Math.round(Math.min(100, Math.max(0, review.risk_score))) };
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function toFindings(review: Review): Finding[] {
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  return [...review.findings].sort((a, b) => order[a.severity] - order[b.severity]);
}
