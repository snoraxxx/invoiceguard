"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BanIcon, CheckCircleIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon } from "lucide-react";
import { saveVendor, setVendorStatus } from "@/app/actions";
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
import { Textarea } from "@/components/ui/textarea";
import type { Vendor } from "@/db/schema";

export function VendorDialog({
  vendor,
  defaults,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  vendor?: Vendor;
  /** Prefill for a new vendor, e.g. details read from a first-time supplier's invoice. */
  defaults?: Partial<Pick<Vendor, "name" | "taxId" | "email" | "address" | "bankName" | "bankAccount" | "bankRouting">>;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, startTransition] = useTransition();
  const values = vendor ?? defaults;

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveVendor(vendor?.id ?? null, formData);
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        vendor ? "Vendor updated" : defaults ? "Supplier registered — re-check the invoice to link it" : "Vendor added",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{vendor ? `Edit ${vendor.name}` : "Add vendor"}</DialogTitle>
          <DialogDescription>
            These details are the source of truth. An invoice asking for payment to a different account will be flagged.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Legal name" name="name" defaultValue={values?.name} required className="sm:col-span-2" />
            <FormField label="Tax ID (GSTIN / VAT / EIN)" name="taxId" defaultValue={values?.taxId} mono />
            <FormField label="Billing email" name="email" type="email" defaultValue={values?.email} />
            <FormField label="Address" name="address" defaultValue={values?.address} className="sm:col-span-2" />
          </div>
          <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <legend className="text-muted-foreground px-1 text-xs font-medium">Registered bank account</legend>
            <FormField label="Bank name" name="bankName" defaultValue={values?.bankName} />
            <FormField label="Routing (IFSC / SWIFT)" name="bankRouting" defaultValue={values?.bankRouting} mono />
            <FormField
              label="Account number / IBAN"
              name="bankAccount"
              defaultValue={values?.bankAccount}
              mono
              className="sm:col-span-2"
            />
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={vendor?.notes ?? ""}
              rows={2}
              placeholder="Anything the agent should know, e.g. usual billing cadence."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {vendor ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  name,
  defaultValue,
  mono,
  className,
  ...props
}: { label: string; name: string; defaultValue?: string | null; mono?: boolean; className?: string } & Omit<
  React.ComponentProps<"input">,
  "defaultValue"
>) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        className={mono ? "font-mono text-[13px]" : undefined}
        {...props}
      />
    </div>
  );
}

export function VendorRowActions({ vendor }: { vendor: Vendor }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const blocked = vendor.status === "blocked";

  function toggleStatus() {
    startTransition(async () => {
      await setVendorStatus(vendor.id, blocked ? "active" : "blocked");
      toast.success(blocked ? `${vendor.name} unblocked` : `${vendor.name} blocked — new invoices will be rejected`);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${vendor.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon /> Edit details
          </DropdownMenuItem>
          <DropdownMenuItem variant={blocked ? "default" : "destructive"} onSelect={toggleStatus}>
            {blocked ? <CheckCircleIcon /> : <BanIcon />}
            {blocked ? "Unblock vendor" : "Block vendor"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <VendorDialog vendor={vendor} open={editing} onOpenChange={setEditing} />
    </>
  );
}
