import { createInvoiceFromUpload, analyzeInvoice } from "@/lib/agent/pipeline";
import { isAIConfigured } from "@/lib/agent/openai";
import { ndjsonResponse } from "@/lib/stream";

export const maxDuration = 300;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (!isAIConfigured()) {
    return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 503 });
  }

  let invoiceId: string;
  try {
    invoiceId = await createInvoiceFromUpload(file);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }

  return ndjsonResponse(async (emit) => {
    emit({ type: "created", invoiceId });
    emit({ type: "stage", stage: "upload", state: "done" });
    await analyzeInvoice(invoiceId, emit);
  });
}
