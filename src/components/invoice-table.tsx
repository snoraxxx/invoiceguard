import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { RiskMeter, StatusBadge } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, timeAgo } from "@/lib/format";
import type { InvoiceListRow } from "@/lib/queries";

export function InvoiceTable({ rows, empty }: { rows: InvoiceListRow[]; empty?: React.ReactNode }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
        <div className="bg-muted flex size-10 items-center justify-center rounded-full">
          <FileTextIcon className="text-muted-foreground size-5" />
        </div>
        <div className="text-muted-foreground text-sm">{empty ?? "No invoices here yet."}</div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Invoice</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead>Invoice date</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Risk</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Uploaded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="relative">
            <TableCell>
              <Link
                href={`/invoices/${row.id}`}
                className="font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              >
                {row.invoiceNumber ?? <span className="text-muted-foreground italic">Unreadable</span>}
              </Link>
              <div className="text-muted-foreground max-w-52 truncate text-xs">{row.fileName}</div>
            </TableCell>
            <TableCell>
              <div className="max-w-56 truncate">{row.registeredVendor ?? row.vendorName ?? "—"}</div>
              {!row.registeredVendor && row.vendorName && (
                <div className="text-critical-ink text-xs">Not in registry</div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(row.invoiceDate)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(row.total, row.currency)}
            </TableCell>
            <TableCell>
              <RiskMeter score={row.riskScore} />
            </TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell className="text-muted-foreground text-right text-xs">{timeAgo(row.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
