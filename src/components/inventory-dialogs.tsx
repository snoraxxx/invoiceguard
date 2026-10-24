"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { createInventoryItem, recordGoodsReceipt } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";

export type ItemOption = { id: string; sku: string; name: string; unit: string; lastCost: number | null };
export type SupplierOption = { name: string; taxId: string | null };

type Line = { key: number; itemId: string; quantity: string; unitCost: string };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: "", quantity: "", unitCost: "" });

export function GoodsReceiptDialog({
  items,
  suppliers,
  suggestedGrn,
  children,
}: {
  items: ItemOption[];
  suppliers: SupplierOption[];
  suggestedGrn: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  function reset() {
    setSupplierName("");
    setSupplierTaxId("");
    setLines([blankLine()]);
  }

  function onSupplierChange(name: string) {
    setSupplierName(name);
    const known = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (known?.taxId && !supplierTaxId) setSupplierTaxId(known.taxId);
  }

  function onSubmit(formData: FormData) {
    const get = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const result = await recordGoodsReceipt({
        grnNumber: get("grnNumber"),
        supplierName,
        supplierTaxId,
        poNumber: get("poNumber"),
        receivedOn: get("receivedOn"),
        receivedBy: get("receivedBy"),
        notes: get("notes"),
        lines: lines.map(({ itemId, quantity, unitCost }) => ({ itemId, quantity, unitCost })),
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${get("grnNumber")} recorded — stock updated`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record a delivery</DialogTitle>
          <DialogDescription>
            Log what actually arrived. Invoices from this supplier will be matched against these quantities and costs.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="supplierName">Supplier</Label>
              <Input
                id="supplierName"
                list={listId}
                required
                value={supplierName}
                onChange={(e) => onSupplierChange(e.target.value)}
                placeholder="Registered vendor or a new supplier"
                autoComplete="off"
              />
              <datalist id={listId}>
                {suppliers.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplierTaxId">Supplier tax ID</Label>
              <Input
                id="supplierTaxId"
                value={supplierTaxId}
                onChange={(e) => setSupplierTaxId(e.target.value)}
                placeholder="From the delivery challan"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="grnNumber">GRN number</Label>
              <Input
                id="grnNumber"
                name="grnNumber"
                required
                defaultValue={suggestedGrn}
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="receivedOn">Received on</Label>
              <Input
                id="receivedOn"
                name="receivedOn"
                type="date"
                required
                defaultValue={format(new Date(), "yyyy-MM-dd")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="poNumber">PO number (optional)</Label>
              <Input id="poNumber" name="poNumber" placeholder="PO-2026-0101" className="font-mono text-[13px]" />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Items received</legend>
            <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_6rem_7.5rem_2rem] gap-2 text-xs sm:grid">
              <span>Item</span>
              <span>Quantity</span>
              <span>Unit cost</span>
            </div>
            {lines.map((line) => {
              const item = items.find((i) => i.id === line.itemId);
              return (
                <div
                  key={line.key}
                  className="grid grid-cols-[1fr_1fr_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_2rem]"
                >
                  <Select
                    value={line.itemId}
                    onValueChange={(itemId) => {
                      const picked = items.find((i) => i.id === itemId);
                      update(line.key, {
                        itemId,
                        unitCost: line.unitCost || (picked?.lastCost != null ? String(picked.lastCost) : ""),
                      });
                    }}
                  >
                    <SelectTrigger className="col-span-3 w-full min-w-0 sm:col-span-1" aria-label="Item">
                      <SelectValue placeholder="Choose an item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          <span className="truncate">{i.name}</span>
                          <span className="text-muted-foreground font-mono text-[11px]">{i.sku}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      required
                      aria-label="Quantity"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                      className="pr-10"
                    />
                    {item && (
                      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                        {item.unit}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    aria-label="Unit cost"
                    placeholder="Unit cost"
                    value={line.unitCost}
                    onChange={(e) => update(line.key, { unitCost: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="self-center"
                    aria-label="Remove line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            <div className="mt-1 flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                <PlusIcon /> Add item
              </Button>
              <span className="text-muted-foreground text-sm">
                Value <span className="text-foreground font-medium tabular-nums">{formatMoney(total)}</span>
              </span>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="receivedBy">Received by</Label>
              <Input id="receivedBy" name="receivedBy" placeholder="Name (team)" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={1} placeholder="Damages, shortages, context" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Record delivery
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InventoryItemDialog({ categories, children }: { categories: string[]; children: React.ReactNode }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createInventoryItem(formData);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${formData.get("name")} added to inventory`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inventory item</DialogTitle>
          <DialogDescription>Add an item to the catalogue so deliveries of it can be recorded.</DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" name="name" required placeholder="LED panel light 2x2 ft 36W" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-sku">SKU</Label>
              <Input
                id="item-sku"
                name="sku"
                required
                placeholder="ELC-LED-PNL"
                className="font-mono text-[13px] uppercase"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-category">Category</Label>
              <Input id="item-category" name="category" required list={listId} placeholder="Electrical" />
              <datalist id={listId}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-unit">Unit</Label>
              <Input id="item-unit" name="unit" required defaultValue="pcs" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-reorder">Reorder level</Label>
              <Input id="item-reorder" name="reorderLevel" type="number" min="0" step="any" defaultValue="0" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
