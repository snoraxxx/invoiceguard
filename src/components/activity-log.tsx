"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BotIcon, Loader2Icon, SettingsIcon, UserIcon } from "lucide-react";
import { addInvoiceNote } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceEvent } from "@/db/schema";
import { cn } from "@/lib/utils";

type Event = Pick<InvoiceEvent, "id" | "actor" | "action" | "message"> & { when: string; ago: string };

const ACTOR = {
  agent: { icon: BotIcon, label: "Agent", className: "bg-brand/10 text-brand" },
  user: { icon: UserIcon, label: "Reviewer", className: "bg-muted text-foreground" },
  system: { icon: SettingsIcon, label: "System", className: "bg-muted text-muted-foreground" },
};

const ACTION_LABEL: Record<string, string> = {
  uploaded: "uploaded the file",
  verified: "verified the invoice",
  flagged: "flagged it for review",
  rejected: "rejected the invoice",
  approved: "approved the invoice",
  "sent back to review": "sent it back to review",
  "reanalysis requested": "requested a re-analysis",
  failed: "could not finish the analysis",
  note: "added a note",
};

export function ActivityLog({ invoiceId, events }: { invoiceId: string; events: Event[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await addInvoiceNote(invoiceId, note);
      if (!result.ok) return void toast.error(result.error);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note for the team…"
          rows={2}
        />
        <Button size="sm" variant="secondary" className="self-end" onClick={submit} disabled={pending || !note.trim()}>
          {pending && <Loader2Icon className="animate-spin" />}
          Add note
        </Button>
      </div>
      <ol className="flex flex-col">
        {events.map((e, i) => {
          const actor = ACTOR[e.actor];
          const Icon = actor.icon;
          return (
            <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
              {i < events.length - 1 && (
                <span className="bg-border absolute top-7 left-[13px] h-[calc(100%-1.75rem)] w-px" />
              )}
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", actor.className)}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                  <span className="font-medium">{actor.label}</span>
                  <span className="text-muted-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>
                </div>
                {e.message && <p className="text-muted-foreground mt-0.5 text-sm break-words">{e.message}</p>}
                <time className="text-muted-foreground/80 text-xs" title={e.when}>
                  {e.ago}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
