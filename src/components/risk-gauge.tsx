import { riskTone } from "@/components/status";
import { cn } from "@/lib/utils";

const TONE = {
  good: { stroke: "var(--status-good)", track: "color-mix(in oklab, var(--status-good) 14%, transparent)" },
  warning: { stroke: "var(--status-warning)", track: "color-mix(in oklab, var(--status-warning) 18%, transparent)" },
  critical: { stroke: "var(--status-critical)", track: "color-mix(in oklab, var(--status-critical) 14%, transparent)" },
  muted: { stroke: "var(--muted-foreground)", track: "var(--muted)" },
};

/** Ring meter for the 0–100 risk score. The fill carries severity; the track is a wash of the same hue. */
export function RiskGauge({ score, className }: { score: number | null; className?: string }) {
  const tone = TONE[riskTone(score)];
  const r = 34;
  const c = 2 * Math.PI * r;
  const value = score ?? 0;
  return (
    <div
      className={cn("relative size-24 shrink-0", className)}
      role="img"
      aria-label={`Risk score ${score ?? "unknown"} out of 100`}
    >
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke={tone.track} strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={tone.stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tracking-tight">{score ?? "—"}</span>
        <span className="text-muted-foreground text-[10px] tracking-wide uppercase">risk</span>
      </div>
    </div>
  );
}
