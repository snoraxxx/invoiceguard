import type { Metadata } from "next";
import { Building2Icon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { VendorDialog, VendorRowActions } from "@/components/vendor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { maskAccount } from "@/lib/match";
import { listVendors } from "@/lib/queries";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const rows = await listVendors();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vendors"
        description="The approved vendor registry. Invoices are checked against these tax IDs and bank accounts."
      >
        <VendorDialog>
          <Button>
            <PlusIcon /> Add vendor
          </Button>
        </VendorDialog>
      </PageHeader>

      <Card className="gap-0 py-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Building2Icon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground text-sm">
              No vendors yet. Add the suppliers you pay so invoices can be matched.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Vendor</TableHead>
                <TableHead>Tax ID</TableHead>
                <TableHead>Bank account</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Verified value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ vendor, invoiceCount, verifiedValue }) => (
                <TableRow key={vendor.id}>
                  <TableCell>
                    <div className="font-medium">{vendor.name}</div>
                    <div className="text-muted-foreground text-xs">{vendor.email ?? "No email on file"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{vendor.taxId ?? "—"}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{maskAccount(vendor.bankAccount)}</div>
                    <div className="text-muted-foreground text-xs">
                      {[vendor.bankName, vendor.bankRouting].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{invoiceCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(verifiedValue, "INR")}</TableCell>
                  <TableCell>
                    {vendor.status === "active" ? (
                      <Badge variant="good">Active</Badge>
                    ) : (
                      <Badge variant="critical">Blocked</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <VendorRowActions vendor={vendor} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
