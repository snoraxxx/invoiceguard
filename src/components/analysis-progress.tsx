"use client";

import { CheckIcon, CircleIcon, Loader2Icon, MinusIcon, SearchIcon, XIcon } from "lucide-react";
import { CheckStatusIcon } from "@/components/status";
import { STAGES, type AnalysisJob } from "@/lib/analysis-client";
import { cn } from "@/lib/utils";

export function AnalysisProgress({ job }: { job: AnalysisJob }) {
  const failedAt = job.phase === "error" ? STAGES.find((s) => job.stages[s.id].state === "running")?.id : undefined;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <ol className="flex flex-col">
        {STAGES.map((stage, i) => {
          const { state, detail } = job.stages[stage.id];
          const failed = failedAt === stage.id;
          return (
            <li key={stage.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < STAGES.length - 1 && (
                <span
                  className={cn(
                    "bg-border absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px",
                    state === "done" && "bg-good/50",
                  )}
                />
              )}
              <span
                className={cn(
                  "bg-card relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border",
                  state === "done" && "border-good/40 bg-good/10 text-good-ink",
                  state === "running" && !failed && "border-brand/40 text-brand",
                  failed && "border-critical/40 bg-critical/10 text-critical-ink",
                  state === "pending" && "text-muted-foreground/50",
                )}
              >
                {failed ? (
                  <XIcon className="size-3.5" />
                ) : state === "done" ? (
                  <CheckIcon className="size-3.5" />
                ) : state === "running" ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : state === "skipped" ? (
                  <MinusIcon className="size-3.5" />
                ) : (
                  <CircleIcon className="size-2" />
                )}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className={cn("text-sm font-medium", state === "pending" && "text-muted-foreground")}>
                  {stage.label}
                </div>
                {detail && stage.id !== "decision" && (
                  <div className="text-muted-foreground text-xs break-words">{detail}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex min-w-0 flex-col gap-4">
        {job.checks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Checks</div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {job.checks.map((c) => (
                <li
                  key={c.id}
                  title={c.detail}
                  className="bg-background animate-in fade-in-0 slide-in-from-bottom-1 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                >
                  <CheckStatusIcon status={c.status} className="size-3.5 shrink-0" />
                  <span className="truncate">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {job.tools.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Agent activity</div>
            <ul className="flex flex-col gap-1.5">
              {job.tools.map((t, i) => (
                <li key={i} className="text-muted-foreground animate-in fade-in-0 flex items-center gap-2 text-xs">
                  <SearchIcon className="text-brand size-3.5 shrink-0" />
                  {t.summary}
                </li>
              ))}
              {job.stages.review.state === "running" && (
                <li className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Loader2Icon className="size-3.5 animate-spin" /> Thinking…
                </li>
              )}
            </ul>
          </div>
        )}
        {job.checks.length === 0 && job.phase === "running" && (
          <div className="text-muted-foreground flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed text-xs">
            <Loader2Icon className="mr-2 size-3.5 animate-spin" />
            {job.stages.extract.state === "running" ? "The agent is reading the document…" : "Starting…"}
          </div>
        )}
      </div>
    </div>
  );
}
