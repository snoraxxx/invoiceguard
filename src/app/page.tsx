import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ShieldAlertIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { InvoiceTable } from "@/components/invoice-table";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { VolumeChart } from "@/components/volume-chart";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { getDailyVolume, getDashboardStats, getTopRiskSignals, listInvoices } from "@/lib/queries";

export default async function DashboardPage() {
  const [stats, volume, signals, verified, flagged, rejected] = await Promise.all([
    getDashboardStats(),
    getDailyVolume(30),
    getTopRiskSignals(),
    listInvoices({ status: "verified", limit: 8 }),
    listInvoices({ status: "flagged", limit: 8 }),
    listInvoices({ status: "rejected", limit: 8 }),
  ]);
  const money = (n: number) => formatMoney(n, stats.currency, { compact: n >= 100000 });
  const maxSignal = Math.max(1, ...signals.map((s) => s.failed + s.warned));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Every invoice is read, cross-checked and reviewed by the agent before it reaches payment."
      >
        <Button asChild>
          <Link href="/upload">
            <UploadIcon />
            Upload invoices
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Verified"
          icon={CheckCircle2Icon}
          tone="good"
          value={stats.verified.count}
          sub={<>{money(stats.verified.value)} cleared for payment</>}
        />
        <StatTile
          label="Needs review"
          icon={AlertTriangleIcon}
          tone="warning"
          value={stats.flagged.count}
          sub={<>{money(stats.flagged.value)} on hold</>}
        />
        <StatTile
          label="Rejected"
          icon={XCircleIcon}
          tone="critical"
          value={stats.rejected.count}
          sub={<>{money(stats.rejected.value)} blocked from payment</>}
        />
        <StatTile
          label="Catch rate"
          icon={ShieldAlertIcon}
          value={`${Math.round(stats.catchRate * 100)}%`}
          sub={<>of {stats.total} invoices raised a concern</>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Invoice volume</CardTitle>
            <CardDescription>Outcomes of invoices uploaded in the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <VolumeChart data={volume} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top risk signals</CardTitle>
            <CardDescription>Checks that tripped most often</CardDescription>
          </CardHeader>
          <CardContent>
            {signals.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">No risk signals yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {signals.map((s) => (
                  <li key={s.label}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{s.label}</span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {s.failed} failed · {s.warned} warned
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 rounded-full">
                      <div
                        className="bg-brand h-full rounded-full"
                        style={{ width: `${((s.failed + s.warned) / maxSignal) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Most recent invoices by outcome</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/invoices">
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <DashboardTabs
          counts={{ verified: stats.verified.count, flagged: stats.flagged.count, rejected: stats.rejected.count }}
          verified={
            <InvoiceTable
              rows={verified}
              empty={
                stats.total === 0 ? (
                  <>
                    Nothing here yet.{" "}
                    <Link className="text-brand font-medium hover:underline" href="/upload">
                      Upload your first invoice
                    </Link>{" "}
                    to get started.
                  </>
                ) : (
                  "No verified invoices yet."
                )
              }
            />
          }
          flagged={<InvoiceTable rows={flagged} empty="Nothing is waiting for review." />}
          rejected={<InvoiceTable rows={rejected} empty="No invoices have been rejected." />}
        />
      </Card>
    </div>
  );
}
