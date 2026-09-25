"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  DownloadIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { deleteInvoice, reviewInvoice } from "@/app/actions";
import { AnalysisProgress } from "@/components/analysis-progress";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceStatus } from "@/db/schema";
import { applyEvent, newJob, streamAnalysis, type AnalysisJob } from "@/lib/analysis-client";

type Decision = "verified" | "rejected";

const DECISION_COPY: Record<Decision, { title: string; description: string; cta: string; placeholder: string }> = {
  verified: {
    title: "Approve this invoice",
    description: "It will be marked verified and cleared for payment. Your note is recorded in the audit trail.",
    cta: "Approve",
    placeholder: "e.g. Called Rahul at the vendor on their registered number — new bank account confirmed.",
  },
  rejected: {
    title: "Reject this invoice",
    description: "It will be blocked from payment. Your note is recorded in the audit trail.",
    cta: "Reject",
    placeholder: "e.g. Vendor confirmed they never sent this invoice.",
  },
};

export function InvoiceActions({ id, status }: { id: string; status: InvoiceStatus }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Keep the page fresh while a background analysis is still running.
  useEffect(() => {
    if (status !== "processing" || job) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [status, job, router]);

  function submitDecision() {
    if (!decision) return;
    startTransition(async () => {
      const result = await reviewInvoice(id, decision, note);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(decision === "verified" ? "Invoice approved" : "Invoice rejected");
      setDecision(null);
      setNote("");
      router.refresh();
    });
  }

  function sendToReview() {
    startTransition(async () => {
      const result = await reviewInvoice(id, "flagged", "");
      if (result.ok) toast.success("Moved back to the review queue");
      else toast.error(result.error);
      router.refresh();
    });
  }

  async function reanalyze() {
    let current: AnalysisJob = { ...newJob(id, "", 0), phase: "running" };
    setJob(current);
    await streamAnalysis(`/api/invoices/${id}/analyze`, {}, (event) => {
      current = applyEvent(current, event);
      setJob(current);
    });
    router.refresh();
  }

  if (status === "processing" && !job) {
    return (
      <Button variant="outline" disabled>
        <Loader2Icon className="animate-spin" /> Analyzing…
      </Button>
    );
  }

  const copy = decision ? DECISION_COPY[decision] : null;
  const running = job?.phase === "running";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === "flagged" || status === "rejected") && (
        <Button
          onClick={() => setDecision("verified")}
          className="bg-good-ink hover:bg-good-ink/90 dark:bg-good dark:hover:bg-good/90 text-white"
        >
          <CheckIcon /> Approve
        </Button>
      )}
      {(status === "flagged" || status === "verified") && (
        <Button
          variant="outline"
          onClick={() => setDecision("rejected")}
          className="text-critical-ink hover:text-critical-ink"
        >
          <XIcon /> Reject
        </Button>
      )}
      <Button variant="outline" onClick={reanalyze} disabled={running}>
        <RefreshCwIcon className={running ? "animate-spin" : ""} /> Re-analyze
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {(status === "verified" || status === "rejected") && (
            <DropdownMenuItem onSelect={sendToReview}>
              <RotateCcwIcon /> Send back to review
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={`/api/invoices/${id}/file`} download>
              <DownloadIcon /> Download original
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2Icon /> Delete invoice
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          {copy && (
            <>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="decision-note">Reason</Label>
                <Textarea
                  id="decision-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={copy.placeholder}
                  rows={3}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDecision(null)}>
                  Cancel
                </Button>
                <Button
                  variant={decision === "rejected" ? "destructive" : "default"}
                  onClick={submitDecision}
                  disabled={pending}
                >
                  {pending && <Loader2Icon className="animate-spin" />}
                  {copy.cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this invoice?</DialogTitle>
            <DialogDescription>
              The file, analysis and audit trail are removed permanently. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => startTransition(() => deleteInvoice(id))}>
              {pending && <Loader2Icon className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={job !== null} onOpenChange={(open) => !open && !running && setJob(null)}>
        <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => running && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Re-analyzing invoice
              {job?.result && <StatusBadge status={job.result.status} />}
            </DialogTitle>
            <DialogDescription>
              {running
                ? "The agent is working through the invoice again with the latest registry data."
                : (job?.error ?? job?.result?.summary)}
            </DialogDescription>
          </DialogHeader>
          {job && <AnalysisProgress job={job} />}
          {!running && (
            <DialogFooter>
              <Button onClick={() => setJob(null)}>Done</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
