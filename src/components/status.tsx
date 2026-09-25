import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleSlashIcon,
  Loader2Icon,
  MinusCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/db/schema";
import type { CheckStatus, Severity } from "@/lib/types";

export const STATUS_META: Record<
  InvoiceStatus,
  { label: string; variant: "good" | "warning" | "critical" | "muted"; icon: typeof CheckCircle2Icon }
> = {
  verified: { label: "Verified", variant: "good", icon: CheckCircle2Icon },
  flagged: { label: "Needs review", variant: "warning", icon: AlertTriangleIcon },
  rejected: { label: "Rejected", variant: "critical", icon: XCircleIcon },
  processing: { label: "Analyzing", variant: "muted", icon: Loader2Icon },
  failed: { label: "Failed", variant: "muted", icon: CircleSlashIcon },
};

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon className={cn(status === "processing" && "animate-spin")} />
      {meta.label}
    </Badge>
  );
}

export function riskTone(score: number | null | undefined) {
  if (score == null) return "muted" as const;
  if (score >= 70) return "critical" as const;
  if (score >= 30) return "warning" as const;
  return "good" as const;
}

const TONE_BG = { good: "bg-good", warning: "bg-warning", critical: "bg-critical", muted: "bg-muted-foreground/40" };

/** Compact meter: the fill carries severity, the track is a light wash of the same hue. */
export function RiskMeter({ score, className }: { score: number | null | undefined; className?: string }) {
  const tone = riskTone(score);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="bg-muted relative h-1.5 w-16 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full", TONE_BG[tone])} style={{ width: `${Math.max(4, score ?? 0)}%` }} />
      </div>
      <span className="text-muted-foreground w-6 text-xs tabular-nums">{score ?? "—"}</span>
    </div>
  );
}

export const CHECK_META: Record<CheckStatus, { icon: typeof CheckCircle2Icon; className: string; label: string }> = {
  pass: { icon: CheckCircle2Icon, className: "text-good-ink", label: "Passed" },
  warn: { icon: AlertTriangleIcon, className: "text-warning-ink", label: "Warning" },
  fail: { icon: XCircleIcon, className: "text-critical-ink", label: "Failed" },
  skip: { icon: MinusCircleIcon, className: "text-muted-foreground", label: "Skipped" },
};

export function CheckStatusIcon({ status, className }: { status: CheckStatus | "pending"; className?: string }) {
  if (status === "pending") return <CircleDashedIcon className={cn("text-muted-foreground size-4", className)} />;
  const { icon: Icon, className: tone, label } = CHECK_META[status];
  return <Icon aria-label={label} className={cn("size-4", tone, className)} />;
}

export const SEVERITY_META: Record<
  Severity,
  { label: string; variant: "good" | "warning" | "critical" | "muted" | "outline" }
> = {
  critical: { label: "Critical", variant: "critical" },
  high: { label: "High", variant: "critical" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Low", variant: "outline" },
  info: { label: "Info", variant: "muted" },
};
