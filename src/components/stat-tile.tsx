import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "good" | "warning" | "critical";
}) {
  return (
    <div className="bg-card rounded-xl border p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span
          className={cn(
            "bg-muted flex size-8 items-center justify-center rounded-lg",
            tone === "good" && "bg-good/10 text-good-ink",
            tone === "warning" && "bg-warning/15 text-warning-ink",
            tone === "critical" && "bg-critical/10 text-critical-ink",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-muted-foreground mt-1 text-xs">{sub}</div>}
    </div>
  );
}
