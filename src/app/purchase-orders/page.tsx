import type { Metadata } from "next";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import { db, vendors } from "@/db";
import { PageHeader } from "@/components/page-header";
import { PurchaseOrderDialog, PurchaseOrderRowActions } from "@/components/purchase-order-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { listPurchaseOrders } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage() {
  const [rows, vendorOptions] = await Promise.all([
    listPurchaseOrders(),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(vendors.name),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchase orders"
        description="Invoices must reference an open PO for the same vendor, and can't bill more than what's left on it."
      >
        <PurchaseOrderDialog vendors={vendorOptions}>
          <Button disabled={vendorOptions.length === 0}>
            <PlusIcon /> New purchase order
          </Button>
        </PurchaseOrderDialog>
      </PageHeader>

      <Card className="gap-0 py-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ClipboardListIcon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground text-sm">
              {vendorOptions.length === 0
                ? "Add a vendor first, then raise purchase orders against it."
                : "No purchase orders yet."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>PO number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-56">Billed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ po, vendorName, billed, invoiceCount }) => {
                const pct = Math.min(100, (billed / po.amount) * 100);
                return (
                  <TableRow key={po.id}>
                    <TableCell>
                      <div className="font-mono text-[13px] font-medium">{po.poNumber}</div>
                      <div className="text-muted-foreground max-w-64 truncate text-xs">{po.description ?? "—"}</div>
                    </TableCell>
                    <TableCell>{vendorName}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(po.issuedOn)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(po.amount, po.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="bg-brand/15 h-1.5 flex-1 rounded-full">
                          <div
                            className={cn("bg-brand h-full rounded-full", pct >= 100 && "bg-warning")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                          {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs tabular-nums">
                        {formatMoney(billed, po.currency)} · {invoiceCount} invoice{invoiceCount === 1 ? "" : "s"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {po.status === "open" ? (
                        <Badge variant="good">Open</Badge>
                      ) : (
                        <Badge variant="muted">Closed</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PurchaseOrderRowActions id={po.id} poNumber={po.poNumber} status={po.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
