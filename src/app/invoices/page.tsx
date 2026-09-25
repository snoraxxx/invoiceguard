import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { InvoiceFilters } from "@/components/invoice-filters";
import { InvoiceTable } from "@/components/invoice-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { invoiceStatus, type InvoiceStatus } from "@/db/schema";
import { listInvoices } from "@/lib/queries";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = (invoiceStatus.enumValues as readonly string[]).includes(String(params.status))
    ? (params.status as InvoiceStatus)
    : undefined;
  const rows = await listInvoices({ q: q || undefined, status });
  const exportHref = `/api/invoices/export?${new URLSearchParams({ ...(q && { q }), ...(status && { status }) })}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" description="Everything that has been uploaded, with the agent's verdict.">
        <Button variant="outline" asChild>
          <a href={exportHref}>
            <DownloadIcon />
            Export CSV
          </a>
        </Button>
        <Button asChild>
          <Link href="/upload">
            <UploadIcon />
            Upload
          </Link>
        </Button>
      </PageHeader>

      <Card className="gap-0 py-0">
        <div className="border-b p-4">
          <InvoiceFilters q={q} status={status ?? "all"} />
        </div>
        <InvoiceTable
          rows={rows}
          empty={q || status ? "No invoices match these filters." : "No invoices yet — upload one to get started."}
        />
        {rows.length > 0 && (
          <div className="text-muted-foreground border-t px-5 py-3 text-xs">
            Showing {rows.length} invoice{rows.length === 1 ? "" : "s"}
            {rows.length === 200 && " (latest 200 — refine the search to see older ones)"}
          </div>
        )}
      </Card>
    </div>
  );
}
