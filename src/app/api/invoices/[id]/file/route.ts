import { eq } from "drizzle-orm";
import { db, invoiceFiles, invoices } from "@/db";

export async function GET(_request: Request, ctx: RouteContext<"/api/invoices/[id]/file">) {
  const { id } = await ctx.params;
  const [row] = await db
    .select({ data: invoiceFiles.data, mimeType: invoices.mimeType, fileName: invoices.fileName })
    .from(invoiceFiles)
    .innerJoin(invoices, eq(invoices.id, invoiceFiles.invoiceId))
    .where(eq(invoiceFiles.invoiceId, id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
