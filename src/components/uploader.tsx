"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  FileIcon,
  FileImageIcon,
  KeyRoundIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { AnalysisProgress } from "@/components/analysis-progress";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { applyEvent, newJob, streamAnalysis, type AnalysisJob } from "@/lib/analysis-client";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACCEPT = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;
const CONCURRENCY = 2;

export function Uploader({ aiReady }: { aiReady: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const files = useRef(new Map<string, File>());
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((key: string, fn: (job: AnalysisJob) => AnalysisJob) => {
    setJobs((all) => all.map((j) => (j.key === key ? fn(j) : j)));
  }, []);

  // Simple queue: keep up to CONCURRENCY jobs running.
  useEffect(() => {
    const running = jobs.filter((j) => j.phase === "running").length;
    const next = jobs.filter((j) => j.phase === "queued").slice(0, Math.max(0, CONCURRENCY - running));
    for (const job of next) {
      const file = files.current.get(job.key);
      if (!file) continue;
      update(job.key, (j) => ({ ...j, phase: "running" }));
      const body = new FormData();
      body.append("file", file);
      streamAnalysis("/api/invoices", { body }, (event) => update(job.key, (j) => applyEvent(j, event)))
        .catch((e: Error) => update(job.key, (j) => ({ ...j, phase: "error", error: e.message })))
        .finally(() => {
          files.current.delete(job.key);
          router.refresh();
        });
    }
  }, [jobs, update, router]);

  function addFiles(list: FileList | File[]) {
    const bad: string[] = [];
    const added: AnalysisJob[] = [];
    for (const file of Array.from(list)) {
      if (!ACCEPT.includes(file.type)) bad.push(`${file.name} — unsupported type`);
      else if (file.size > MAX_BYTES) bad.push(`${file.name} — larger than 15 MB`);
      else {
        const key = crypto.randomUUID();
        files.current.set(key, file);
        added.push(newJob(key, file.name, file.size));
      }
    }
    setRejected(bad);
    setJobs((all) => [...added, ...all]);
  }

  const active = jobs.some((j) => j.phase === "running" || j.phase === "queued");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!aiReady && (
        <div className="border-warning/40 bg-warning/10 flex gap-3 rounded-xl border p-4 text-sm">
          <KeyRoundIcon className="text-warning-ink mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">The agent is not configured</div>
            <div className="text-muted-foreground">
              Add <code className="bg-muted rounded px-1 font-mono text-xs">OPENAI_API_KEY</code> to{" "}
              <code className="bg-muted rounded px-1 font-mono text-xs">.env</code> and restart the server to start
              verifying invoices.
            </div>
          </div>
        </div>
      )}

      <div
        role="button"
        tabIndex={aiReady ? 0 : -1}
        aria-disabled={!aiReady}
        onClick={() => aiReady && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (aiReady && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (aiReady) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (aiReady && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group bg-card focus-visible:ring-ring/40 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors outline-none focus-visible:ring-[3px]",
          aiReady ? "hover:border-brand/50 hover:bg-brand/[0.03] cursor-pointer" : "cursor-not-allowed opacity-60",
          dragging && "border-brand bg-brand/5",
        )}
      >
        <span className="bg-brand/10 text-brand flex size-12 items-center justify-center rounded-full transition-transform group-hover:scale-105">
          <UploadCloudIcon className="size-6" />
        </span>
        <div>
          <div className="font-medium">
            Drop invoices here or <span className="text-brand">browse</span>
          </div>
          <div className="text-muted-foreground mt-1 text-sm">
            PDF, PNG, JPG or WebP · up to 15 MB each · multiple files welcome
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 && (
        <div className="border-critical/30 bg-critical/5 text-critical-ink flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            {rejected.map((r) => (
              <div key={r}>{r}</div>
            ))}
          </div>
          <button aria-label="Dismiss" onClick={() => setRejected([])}>
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">
            {jobs.filter((j) => j.phase === "done").length} of {jobs.length} analyzed
          </div>
          {!active && (
            <Button variant="ghost" size="sm" onClick={() => setJobs([])}>
              Clear
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {jobs.map((job) => (
          <JobCard key={job.key} job={job} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: AnalysisJob }) {
  const Icon = job.name.toLowerCase().endsWith(".pdf") ? FileIcon : FileImageIcon;
  return (
    <div className="bg-card animate-in fade-in-0 slide-in-from-top-2 overflow-hidden rounded-xl border shadow-xs">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="text-muted-foreground size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{job.name}</div>
          <div className="text-muted-foreground text-xs">
            {formatBytes(job.size)}
            {job.phase === "queued" && " · waiting in queue"}
          </div>
        </div>
        {job.result && <StatusBadge status={job.result.status} />}
        {job.phase === "error" && <StatusBadge status="failed" />}
      </div>

      {job.phase !== "queued" && (
        <div className="px-5 py-4">
          <AnalysisProgress job={job} />
        </div>
      )}

      {job.result && (
        <div className="bg-muted/40 flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center">
          <p className="text-muted-foreground flex-1 text-sm">
            <span className="text-foreground font-medium">Risk {job.result.riskScore}/100.</span> {job.result.summary}
          </p>
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <Link href={`/invoices/${job.result.invoiceId}`}>
              Open invoice <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      )}

      {job.phase === "error" && (
        <div className="bg-critical/5 flex flex-col gap-3 border-t px-5 py-3 text-sm sm:flex-row sm:items-center">
          <p className="text-critical-ink flex-1">{job.error}</p>
          {job.invoiceId && (
            <Button size="sm" variant="outline" asChild className="shrink-0">
              <Link href={`/invoices/${job.invoiceId}`}>Open invoice</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
