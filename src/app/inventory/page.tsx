import type { Metadata } from "next";
import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { BoxesIcon, PackageCheckIcon, PackagePlusIcon, PlusIcon, TruckIcon, UserPlusIcon } from "lucide-react";
import { db, vendors } from "@/db";
import { GoodsReceiptDialog, InventoryItemDialog } from "@/components/inventory-dialogs";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatMoney } from "@/lib/format";
import { listDeliveries, listInventory, type DeliveryRow, type InventoryRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/db/schema";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const [deliveries, stock, registry] = await Promise.all([
    listDeliveries(),
    listInventory(),
    db.select({ name: vendors.name, taxId: vendors.taxId }).from(vendors).orderBy(vendors.name),
  ]);

  const awaiting = deliveries.filter((d) => !d.billedBy);
  const fromNew = deliveries.filter((d) => !d.registeredVendor);
  const lowStock = stock.filter((s) => s.item.quantityOnHand <= s.item.reorderLevel);
  const recentValue = deliveries
    .filter((d) => differenceInCalendarDays(new Date(), parseISO(d.receivedOn)) < 30)
    .reduce((s, d) => s + d.value, 0);

  const suppliers = new Map<string, { name: string; taxId: string | null }>();
  for (const v of registry) suppliers.set(v.name.toLowerCase(), v);
  for (const d of deliveries) {
    if (!suppliers.has(d.supplierName.toLowerCase())) {
      suppliers.set(d.supplierName.toLowerCase(), { name: d.supplierName, taxId: d.supplierTaxId });
    }
  }
  const itemOptions = stock.map(({ item, lastUnitCost }) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    lastCost: lastUnitCost,
  }));
  const categories = [...new Set(stock.map((s) => s.item.category))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Goods received at the warehouse. Invoices are matched line by line against these deliveries — that's how first-time suppliers get verified."
      >
        <InventoryItemDialog categories={categories}>
          <Button variant="outline">
            <PackagePlusIcon /> New item
          </Button>
        </InventoryItemDialog>
        <GoodsReceiptDialog
          items={itemOptions}
          suppliers={[...suppliers.values()]}
          suggestedGrn={nextGrnNumber(deliveries)}
        >
          <Button disabled={itemOptions.length === 0}>
            <PlusIcon /> Record delivery
          </Button>
        </GoodsReceiptDialog>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Awaiting invoice"
          icon={TruckIcon}
          value={awaiting.length}
          sub={<>{formatMoney(awaiting.reduce((s, d) => s + d.value, 0))} received, not yet billed</>}
        />
        <StatTile
          label="From new suppliers"
          icon={UserPlusIcon}
          tone={fromNew.length > 0 ? "warning" : "default"}
          value={fromNew.length}
          sub="deliveries from suppliers not in the registry"
        />
        <StatTile
          label="Received, last 30 days"
          icon={PackageCheckIcon}
          tone="good"
          value={formatMoney(recentValue, "INR", { compact: true })}
          sub={<>{deliveries.length} deliveries on record</>}
        />
        <StatTile
          label="Items tracked"
          icon={BoxesIcon}
          tone={lowStock.length > 0 ? "critical" : "default"}
          value={stock.length}
          sub={lowStock.length > 0 ? `${lowStock.length} at or below reorder level` : "All above reorder level"}
        />
      </div>

      <Card className="gap-0 py-0">
        <Tabs defaultValue="deliveries" className="gap-0">
          <div className="border-b px-5 py-3">
            <TabsList>
              <TabsTrigger value="deliveries">
                Deliveries
                <Count n={deliveries.length} />
              </TabsTrigger>
              <TabsTrigger value="stock">
                Stock
                <Count n={stock.length} />
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="deliveries">
            <DeliveriesTable rows={deliveries} />
          </TabsContent>
          <TabsContent value="stock">
            <StockTable rows={stock} />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] tabular-nums">{n}</span>;
}

function nextGrnNumber(rows: DeliveryRow[]) {
  const year = new Date().getFullYear();
  const max = rows.reduce((m, r) => Math.max(m, Number(r.grnNumber.match(/(\d+)$/)?.[1] ?? 0)), 0);
  return `GRN-${year}-${String(max + 1).padStart(4, "0")}`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <BoxesIcon className="text-muted-foreground size-6" />
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function DeliveriesTable({ rows }: { rows: DeliveryRow[] }) {
  if (rows.length === 0) return <Empty>No deliveries recorded yet.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Delivery</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Items received</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead>Invoice</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id} className="align-top">
            <TableCell>
              <div className="font-mono text-[13px] font-medium">{d.grnNumber}</div>
              <div className="text-muted-foreground text-xs">{formatDate(d.receivedOn)}</div>
            </TableCell>
            <TableCell>
              <div className="max-w-56 truncate">{d.supplierName}</div>
              {d.registeredVendor ? (
                <div className="text-muted-foreground font-mono text-[11px]">{d.supplierTaxId ?? "No tax ID"}</div>
              ) : (
                <Badge variant="warning" className="mt-1">
                  New supplier
                </Badge>
              )}
            </TableCell>
            <TableCell>
              <ul className="flex max-w-80 flex-col gap-0.5 text-[13px]">
                {d.lines.map((l) => (
                  <li key={l.sku} className="flex gap-1.5">
                    <span className="shrink-0 font-medium tabular-nums">
                      {l.quantity.toLocaleString("en-IN")} {l.unit}
                    </span>
                    <span className="text-muted-foreground truncate">{l.name}</span>
                  </li>
                ))}
              </ul>
              {d.notes && <div className="text-muted-foreground mt-1 max-w-80 text-xs italic">{d.notes}</div>}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(d.value)}</TableCell>
            <TableCell>
              {d.billedBy ? (
                <Link href={`/invoices/${d.billedBy.invoiceId}`} className="group flex flex-col gap-1">
                  <span className="font-mono text-[13px] group-hover:underline">
                    {d.billedBy.invoiceNumber ?? "Invoice"}
                  </span>
                  <StatusBadge status={d.billedBy.status as InvoiceStatus} />
                </Link>
              ) : (
                <Badge variant="muted">Awaiting invoice</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StockTable({ rows }: { rows: InventoryRow[] }) {
  if (rows.length === 0) return <Empty>No items yet. Add the goods you buy to start recording deliveries.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Item</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">On hand</TableHead>
          <TableHead className="text-right">Reorder at</TableHead>
          <TableHead>Last received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ item, lastReceivedOn, lastSupplier, lastUnitCost }) => {
          const low = item.quantityOnHand <= item.reorderLevel;
          return (
            <TableRow key={item.id}>
              <TableCell>
                <div className="max-w-72 truncate font-medium">{item.name}</div>
                <div className="text-muted-foreground font-mono text-[11px]">{item.sku}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{item.category}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {low && <Badge variant="critical">Low</Badge>}
                  <span className={cn("font-medium tabular-nums", low && "text-critical-ink")}>
                    {item.quantityOnHand.toLocaleString("en-IN")}
                  </span>
                  <span className="text-muted-foreground w-9 text-left text-xs">{item.unit}</span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {item.reorderLevel.toLocaleString("en-IN")}
              </TableCell>
              <TableCell>
                {lastReceivedOn ? (
                  <>
                    <div className="text-[13px]">
                      {formatDate(lastReceivedOn)} · {formatMoney(lastUnitCost)}
                      <span className="text-muted-foreground">/{item.unit}</span>
                    </div>
                    <div className="text-muted-foreground max-w-56 truncate text-xs">{lastSupplier}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
