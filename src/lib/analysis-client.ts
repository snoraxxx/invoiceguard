import type { AnalysisEvent, CheckResult, Stage } from "@/lib/types";

export type StageState = "pending" | "running" | "done" | "skipped";

export type AnalysisJob = {
  key: string;
  name: string;
  size: number;
  invoiceId?: string;
  phase: "queued" | "running" | "done" | "error";
  stages: Record<Stage, { state: StageState; detail?: string }>;
  checks: CheckResult[];
  tools: { name: string; summary: string }[];
  result?: Extract<AnalysisEvent, { type: "result" }>;
  error?: string;
};

export const STAGES: { id: Stage; label: string }[] = [
  { id: "upload", label: "Uploaded" },
  { id: "extract", label: "Reading document" },
  { id: "checks", label: "Rule checks" },
  { id: "review", label: "Agent investigation" },
  { id: "decision", label: "Decision" },
];

export function newJob(key: string, name: string, size: number): AnalysisJob {
  return {
    key,
    name,
    size,
    phase: "queued",
    stages: Object.fromEntries(STAGES.map((s) => [s.id, { state: "pending" }])) as AnalysisJob["stages"],
    checks: [],
    tools: [],
  };
}

export function applyEvent(job: AnalysisJob, event: AnalysisEvent): AnalysisJob {
  switch (event.type) {
    case "created":
      return { ...job, invoiceId: event.invoiceId };
    case "stage":
      return { ...job, stages: { ...job.stages, [event.stage]: { state: event.state, detail: event.detail } } };
    case "check":
      return { ...job, checks: [...job.checks, event.check] };
    case "tool":
      return { ...job, tools: [...job.tools, { name: event.name, summary: event.summary }] };
    case "result":
      return { ...job, phase: "done", invoiceId: event.invoiceId, result: event };
    case "error":
      return { ...job, phase: "error", error: event.message, invoiceId: event.invoiceId ?? job.invoiceId };
  }
}

/** POSTs to an analysis endpoint and feeds every streamed NDJSON event to `onEvent`. */
export async function streamAnalysis(url: string, init: RequestInit, onEvent: (event: AnalysisEvent) => void) {
  const response = await fetch(url, { method: "POST", ...init });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    onEvent({ type: "error", message: body?.error ?? `Request failed (${response.status})` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AnalysisEvent;
      if (event.type === "result" || event.type === "error") finished = true;
      onEvent(event);
    }
  }
  if (!finished) onEvent({ type: "error", message: "The connection closed before analysis finished." });
}
