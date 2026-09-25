"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2Icon, LockIcon, MoreHorizontalIcon, UnlockIcon } from "lucide-react";
import { createPurchaseOrder, setPurchaseOrderStatus } from "@/app/actions";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PurchaseOrderDialog({
  vendors,
  children,
}: {
  vendors: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createPurchaseOrder(formData);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`PO ${formData.get("poNumber")} created`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Invoices quoting this PO number will be matched against it.</DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="poNumber">PO number</Label>
              <Input
                id="poNumber"
                name="poNumber"
                required
                placeholder="PO-2026-0042"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="issuedOn">Issued on</Label>
              <Input
                id="issuedOn"
                name="issuedOn"
                type="date"
                required
                defaultValue={format(new Date(), "yyyy-MM-dd")}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Vendor</Label>
            <Select name="vendorId" required>
              <SelectTrigger>
                <SelectValue placeholder="Choose a vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" placeholder="What is being purchased" />
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="amount">Approved amount</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0" required placeholder="250000" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="INR" maxLength={3} className="uppercase" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Create PO
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseOrderRowActions({
  id,
  poNumber,
  status,
}: {
  id: string;
  poNumber: string;
  status: "open" | "closed";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${poNumber}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            startTransition(async () => {
              await setPurchaseOrderStatus(id, status === "open" ? "closed" : "open");
              toast.success(`PO ${poNumber} ${status === "open" ? "closed" : "reopened"}`);
              router.refresh();
            })
          }
        >
          {status === "open" ? <LockIcon /> : <UnlockIcon />}
          {status === "open" ? "Close PO" : "Reopen PO"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
