import type { NextRequest } from "next/server";
import { invoiceStatus, type InvoiceStatus } from "@/db/schema";
import { listInvoices } from "@/lib/queries";

function csvCell(value: unknown) {
  if (value == null) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const s = request.nextUrl.searchParams.get("status");
  const status = s && (invoiceStatus.enumValues as readonly string[]).includes(s) ? (s as InvoiceStatus) : undefined;
  const rows = await listInvoices({ q, status, limit: 10000 });

  const header = [
    "Invoice number",
    "Vendor",
    "Registered vendor",
    "Invoice date",
    "Due date",
    "Currency",
    "Total",
    "PO number",
    "Status",
    "Risk score",
    "Decided by",
    "Uploaded at",
    "File",
    "Summary",
  ];
  const lines = rows.map((r) =>
    [
      r.invoiceNumber,
      r.vendorName,
      r.registeredVendor,
      r.invoiceDate,
      r.dueDate,
      r.currency,
      r.total,
      r.poNumber,
      r.status,
      r.riskScore,
      r.decidedBy,
      r.createdAt,
      r.fileName,
      r.summary,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
