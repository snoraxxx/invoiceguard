"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "verified", label: "Verified" },
  { value: "flagged", label: "Needs review" },
  { value: "rejected", label: "Rejected" },
  { value: "processing", label: "Analyzing" },
  { value: "failed", label: "Failed" },
];

export function InvoiceFilters({ q, status }: { q: string; status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(q);
  const [pending, startTransition] = useTransition();

  function navigate(next: { q?: string; status?: string }) {
    const params = new URLSearchParams();
    const nq = next.q ?? query;
    const ns = next.status ?? status;
    if (nq) params.set("q", nq);
    if (ns && ns !== "all") params.set("status", ns);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`));
  }

  // Debounce typing into the search box.
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => navigate({ q: query }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        {pending ? (
          <Loader2Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin" />
        ) : (
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoice number, vendor, PO or file name"
          className="pl-9"
        />
      </div>
      <Select value={status} onValueChange={(v) => navigate({ status: v })}>
        <SelectTrigger className="sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
