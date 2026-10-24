import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  ArrowLeftIcon,
  BotIcon,
  ExternalLinkIcon,
  InfoIcon,
  ListChecksIcon,
  PackageCheckIcon,
  UserIcon,
  UserPlusIcon,
} from "lucide-react";
import { db, invoiceEvents, invoices, purchaseOrders, vendors } from "@/db";
import { ActivityLog } from "@/components/activity-log";
import { InvoiceActions } from "@/components/invoice-actions";
import { RiskGauge } from "@/components/risk-gauge";
import { VendorDialog } from "@/components/vendor-dialog";
import { CheckStatusIcon, SEVERITY_META, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatDate, formatDateTime, formatMoney, timeAgo } from "@/lib/format";
import { maskAccount, normalizeId, normalizeName } from "@/lib/match";
import type { ReceiptLineStatus, ReceiptMatch } from "@/lib/types";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/invoices/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [row] = await db.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, id)).limit(1);
  return { title: row?.n ?? "Invoice" };
}

const UUID = /^[0-9a-f-]{36}$/i;

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [row] = await db
    .select({ invoice: invoices, vendor: vendors, po: purchaseOrders })
    .from(invoices)
    .leftJoin(vendors, eq(vendors.id, invoices.vendorId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, invoices.purchaseOrderId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) notFound();
  const { invoice, vendor, po } = row;
  const events = await db
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, id))
    .orderBy(desc(invoiceEvents.createdAt));

  const money = (n: number | null) => formatMoney(n, invoice.currency);
  const analyzed = invoice.status !== "processing" && invoice.status !== "failed";
  const failedChecks = invoice.checks.filter((c) => c.status === "fail").length;
  const warnChecks = invoice.checks.filter((c) => c.status === "warn").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/invoices"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-3.5" /> Invoices
        </Link>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{invoice.invoiceNumber ?? "Unnumbered invoice"}</h1>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {invoice.vendorName ?? "Unknown vendor"} · {money(invoice.total)} · uploaded {timeAgo(invoice.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!vendor && invoice.vendorName && analyzed && invoice.status !== "rejected" && (
              <VendorDialog
                defaults={{
                  name: invoice.vendorName,
                  taxId: invoice.vendorTaxId,
                  email: invoice.vendorEmail,
                  address: invoice.vendorAddress,
                  bankName: invoice.bankName,
                  bankAccount: invoice.bankAccount,
                  bankRouting: invoice.bankRouting,
                }}
              >
                <Button variant="outline">
                  <UserPlusIcon /> Register supplier
                </Button>
              </VendorDialog>
            )}
            <InvoiceActions id={invoice.id} status={invoice.status} />
          </div>
        </div>
      </div>

      {invoice.status === "failed" && (
        <div className="border-critical/30 bg-critical/5 rounded-xl border px-5 py-4 text-sm">
          <div className="text-critical-ink font-medium">Analysis failed</div>
          <div className="text-muted-foreground mt-0.5">{invoice.error}</div>
        </div>
      )}

      {analyzed && (
        <Card className="flex-row items-center gap-6 px-6">
          <RiskGauge score={invoice.riskScore} />
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              {invoice.decidedBy === "user" ? (
                <span className="inline-flex items-center gap-1">
                  <UserIcon className="size-3.5" /> Decision by reviewer
                </span>
              ) : invoice.decidedBy === "system" ? (
                <span className="inline-flex items-center gap-1">
                  <ListChecksIcon className="size-3.5" /> Decision by rule checks
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <BotIcon className="size-3.5" /> Decision by agent
                </span>
              )}
              <span>·</span>
              <span>
                {failedChecks} failed, {warnChecks} warnings of {invoice.checks.length} checks
              </span>
              {invoice.model && (
                <>
                  <span>·</span>
                  <span className="font-mono">{invoice.model}</span>
                </>
              )}
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-pretty">
              {invoice.summary ??
                "This record was imported with rule checks only — re-analyze it to get the agent's review."}
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {invoice.findings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Agent findings</CardTitle>
                <CardDescription>What the agent concluded after investigating</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {invoice.findings.map((f, i) => (
                    <li key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
                      <div className="w-20 shrink-0 pt-0.5">
                        <Badge variant={SEVERITY_META[f.severity].variant}>{SEVERITY_META[f.severity].label}</Badge>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{f.title}</div>
                        <div className="text-muted-foreground text-sm">{f.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {invoice.checks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Verification checks</CardTitle>
                <CardDescription>
                  Deterministic rules run against your vendor registry, purchase orders and invoice history
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {invoice.checks.map((c) => (
                    <li key={c.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                      <CheckStatusIcon status={c.status} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{c.label}</div>
                        <div className="text-muted-foreground text-sm">{c.detail}</div>
                      </div>
                      {c.weight > 0 && (
                        <span
                          className="bg-muted text-muted-foreground h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums"
                          title="Risk points"
                        >
                          +{c.weight}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {invoice.receiptMatch && invoice.receiptMatch.lines.length > 0 && (
            <GoodsReceivedCard match={invoice.receiptMatch} currency={invoice.currency} />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Extracted details</CardTitle>
              <CardDescription>
                Read from the document{vendor ? `, compared with the registry record for ${vendor.name}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Vendor" value={invoice.vendorName} registry={vendor?.name} same={sameName} />
                <Field label="Tax ID" value={invoice.vendorTaxId} registry={vendor?.taxId} same={sameId} mono />
                <Field
                  label="Pay to account"
                  value={invoice.bankAccount}
                  registry={vendor?.bankAccount}
                  display={maskAccount}
                  same={sameId}
                  mono
                />
                <Field
                  label="Routing code"
                  value={invoice.bankRouting}
                  registry={vendor?.bankRouting}
                  same={sameId}
                  note={invoice.bankName ?? undefined}
                  mono
                />
                <Field label="Email" value={invoice.vendorEmail} />
                <Field
                  label="PO number"
                  value={invoice.poNumber}
                  note={po ? `${formatMoney(po.amount, po.currency)} · ${po.status}` : undefined}
                  mono
                />
                <Field label="Invoice date" value={formatDate(invoice.invoiceDate)} />
                <Field label="Due date" value={formatDate(invoice.dueDate)} />
                <Field label="Address" value={invoice.vendorAddress} className="sm:col-span-2" />
              </dl>

              {invoice.lineItems.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-muted-foreground text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Description</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Unit price</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {invoice.lineItems.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="text-muted-foreground px-3 py-2 text-right">{item.quantity ?? "—"}</td>
                          <td className="text-muted-foreground px-3 py-2 text-right">{money(item.unitPrice)}</td>
                          <td className="px-3 py-2 text-right">{money(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t tabular-nums">
                      <tr>
                        <td colSpan={3} className="text-muted-foreground px-3 pt-2 text-right">
                          Subtotal
                        </td>
                        <td className="px-3 pt-2 text-right">{money(invoice.subtotal)}</td>
                      </tr>
                      <tr>
                        <td colSpan={3} className="text-muted-foreground px-3 text-right">
                          Tax
                        </td>
                        <td className="px-3 text-right">{money(invoice.taxAmount)}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td colSpan={3} className="px-3 pt-1 pb-2 text-right">
                          Total
                        </td>
                        <td className="px-3 pt-1 pb-2 text-right">{money(invoice.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {invoice.agentSteps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>How the agent investigated</CardTitle>
                <CardDescription>Every lookup the agent made before reaching its verdict</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-2">
                  {invoice.agentSteps.map((step, i) => (
                    <li key={i}>
                      <details className="group bg-background rounded-lg border">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                          <span className="bg-brand/10 text-brand flex size-5 items-center justify-center rounded text-[11px] font-semibold tabular-nums">
                            {i + 1}
                          </span>
                          <code className="font-mono text-xs">{step.name}</code>
                          <span className="text-muted-foreground truncate text-xs">{JSON.stringify(step.input)}</span>
                          <span className="text-muted-foreground ml-auto text-xs group-open:hidden">Show result</span>
                        </summary>
                        <pre className="bg-muted/40 max-h-64 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                          {prettyJson(step.output)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="gap-0 overflow-hidden py-0 xl:sticky xl:top-6">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{invoice.fileName}</div>
                <div className="text-muted-foreground text-xs">
                  {formatBytes(invoice.fileSize)} · sha256 {invoice.fileSha256.slice(0, 10)}…
                </div>
              </div>
              <a
                href={`/api/invoices/${invoice.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="text-brand inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
              >
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </div>
            <div className="bg-muted/50">
              {invoice.mimeType === "application/pdf" ? (
                <iframe
                  src={`/api/invoices/${invoice.id}/file#view=FitH`}
                  title="Invoice document"
                  className="h-[34rem] w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/invoices/${invoice.id}/file`}
                  alt="Invoice document"
                  className="max-h-[34rem] w-full object-contain"
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Audit trail of every decision</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityLog
                invoiceId={invoice.id}
                events={events.map((e) => ({ ...e, when: formatDateTime(e.createdAt), ago: timeAgo(e.createdAt) }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const LINE_STATUS: Record<ReceiptLineStatus, { label: string; variant: "good" | "warning" | "critical" }> = {
  matched: { label: "Matched", variant: "good" },
  price_mismatch: { label: "Price higher", variant: "warning" },
  over_quantity: { label: "More than received", variant: "critical" },
  not_received: { label: "Not received", variant: "critical" },
};

function GoodsReceivedCard({ match, currency }: { match: ReceiptMatch; currency: string | null }) {
  const money = (n: number | null) => formatMoney(n, currency);
  const qty = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN"));
  const matched = match.lines.filter((l) => l.status === "matched").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheckIcon className="text-brand size-4" /> Goods received match
        </CardTitle>
        <CardDescription>
          {match.receipts.length > 0 ? (
            <>
              {matched} of {match.lines.length} lines match deliveries on{" "}
              {match.receipts.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href="/inventory" className="text-foreground font-mono text-xs hover:underline">
                    {r.grnNumber}
                  </Link>{" "}
                  ({formatDate(r.receivedOn)})
                </span>
              ))}
            </>
          ) : (
            "None of the invoiced lines match goods we received from this supplier"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice line</th>
                <th className="px-3 py-2 text-right font-medium">Billed</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Received, unbilled</th>
                <th className="px-3 py-2 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {match.lines.map((l, i) => {
                const meta = LINE_STATUS[l.status];
                return (
                  <tr key={i} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div>{l.description}</div>
                      {l.item ? (
                        <div className="text-muted-foreground text-xs">
                          {l.item.name} · <span className="font-mono whitespace-nowrap">{l.item.sku}</span>
                        </div>
                      ) : (
                        <div className="text-critical-ink text-xs">No matching delivery</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {qty(l.quantity)} × {money(l.unitPrice)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right whitespace-nowrap",
                        !l.item && "text-muted-foreground",
                        l.status === "over_quantity" && "text-critical-ink",
                      )}
                    >
                      {l.item ? (
                        <>
                          {qty(l.receivedQuantity)} ×{" "}
                          <span className={cn(l.status === "price_mismatch" && "text-warning-ink")}>
                            {money(l.receivedUnitCost)}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const sameId = (a: string, b: string) => normalizeId(a) === normalizeId(b);
const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

function prettyJson(s: string | undefined) {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function Field({
  label,
  value,
  registry,
  display = (v) => v,
  same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase(),
  mono,
  note,
  className,
}: {
  label: string;
  value: string | null;
  registry?: string | null;
  display?: (v: string) => string;
  same?: (a: string, b: string) => boolean;
  mono?: boolean;
  note?: string;
  className?: string;
}) {
  const hasBoth = value && registry;
  const matches = hasBoth && same(value, registry);
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("mt-0.5 text-sm break-words", mono && "font-mono text-[13px]")}>
        {value ? display(value) : <span className="text-muted-foreground">—</span>}
      </dd>
      {hasBoth && !matches && (
        <div className="text-critical-ink mt-1 flex items-center gap-1 text-xs">
          <InfoIcon className="size-3" /> Registry: <span className={cn(mono && "font-mono")}>{display(registry)}</span>
        </div>
      )}
      {note && <div className="text-muted-foreground mt-0.5 text-xs">{note}</div>}
    </div>
  );
}
