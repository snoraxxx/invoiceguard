"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { BarChart3Icon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DailyVolume } from "@/lib/queries";

const SERIES = [
  { key: "verified", label: "Verified", color: "var(--status-good)" },
  { key: "flagged", label: "Needs review", color: "var(--status-warning)" },
  { key: "rejected", label: "Rejected", color: "var(--status-critical)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function topSegment(d: DailyVolume): SeriesKey | null {
  for (let i = SERIES.length - 1; i >= 0; i--) if (d[SERIES[i].key] > 0) return SERIES[i].key;
  return null;
}

type SegmentProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: DailyVolume };

/** Stacked segment: 4px rounded data-end on the top-most segment only, 2px surface gap between segments. */
function Segment({ x = 0, y = 0, width = 0, height = 0, fill, payload, series }: SegmentProps & { series: SeriesKey }) {
  if (height <= 0 || !payload) return null;
  const index = SERIES.findIndex((s) => s.key === series);
  const gap = SERIES.slice(0, index).some((s) => payload[s.key] > 0) ? 2 : 0;
  const h = Math.max(0, height - gap);
  if (h <= 0) return null;
  const r = topSegment(payload) === series ? Math.min(4, h, width / 2) : 0;
  const path = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`;
  return <path d={path} fill={fill} />;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DailyVolume;
  const total = d.verified + d.flagged + d.rejected;
  return (
    <div className="bg-popover min-w-40 rounded-lg border px-3 py-2.5 text-xs shadow-lg">
      <div className="mb-1.5 font-medium">{format(parseISO(d.day), "EEE, d MMM")}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="font-medium tabular-nums">{d[s.key]}</span>
        </div>
      ))}
      <div className="text-muted-foreground mt-1.5 flex justify-between border-t pt-1.5">
        <span>Total</span>
        <span className="text-foreground font-medium tabular-nums">{total}</span>
      </div>
    </div>
  );
}

export function VolumeChart({ data }: { data: DailyVolume[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const totals = SERIES.map((s) => ({ ...s, total: data.reduce((sum, d) => sum + d[s.key], 0) }));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {totals.map((s) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
              <span className="text-foreground font-medium tabular-nums">{s.total}</span>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 text-xs"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
        >
          {view === "chart" ? <TableIcon /> : <BarChart3Icon />}
          {view === "chart" ? "Table" : "Chart"}
        </Button>
      </div>

      {view === "chart" ? (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
                interval={6}
                tickMargin={8}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                width={44}
              />
              <Tooltip
                content={ChartTooltip}
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                isAnimationActive={false}
              />
              {SERIES.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="outcome"
                  fill={s.color}
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={(props: SegmentProps) => <Segment {...props} series={s.key} />}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-60 overflow-y-auto rounded-md border text-xs">
          <table className="w-full">
            <thead className="bg-muted text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Day</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-t">
                  <td className="px-3 py-1.5">{format(parseISO(d.day), "d MMM")}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
