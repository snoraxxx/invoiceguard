import { eq } from "drizzle-orm";
import { db, invoiceEvents, invoices } from "@/db";
import { analyzeInvoice } from "@/lib/agent/pipeline";
import { isAIConfigured } from "@/lib/agent/openai";
import { ndjsonResponse } from "@/lib/stream";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/invoices/[id]/analyze">) {
  const { id } = await ctx.params;
  if (!isAIConfigured()) {
    return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 503 });
  }
  const [invoice] = await db
    .select({ status: invoices.status, updatedAt: invoices.updatedAt })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });
  const stuck = Date.now() - invoice.updatedAt.getTime() > 5 * 60 * 1000;
  if (invoice.status === "processing" && !stuck) {
    return Response.json({ error: "This invoice is already being analyzed." }, { status: 409 });
  }

  await db.insert(invoiceEvents).values({ invoiceId: id, actor: "user", action: "reanalysis requested" });
  return ndjsonResponse(async (emit) => {
    emit({ type: "stage", stage: "upload", state: "done" });
    await analyzeInvoice(id, emit);
  });
}
