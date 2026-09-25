import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { format, subDays } from "date-fns";
import { db, invoices, purchaseOrders, vendors, type InvoiceStatus } from "@/db";

export const invoiceListColumns = {
  id: invoices.id,
  status: invoices.status,
  riskScore: invoices.riskScore,
  invoiceNumber: invoices.invoiceNumber,
  vendorName: invoices.vendorName,
  registeredVendor: vendors.name,
  invoiceDate: invoices.invoiceDate,
  dueDate: invoices.dueDate,
  total: invoices.total,
  currency: invoices.currency,
  fileName: invoices.fileName,
  poNumber: invoices.poNumber,
  summary: invoices.summary,
  decidedBy: invoices.decidedBy,
  createdAt: invoices.createdAt,
};

export type InvoiceListRow = Awaited<ReturnType<typeof listInvoices>>[number];

export async function listInvoices(opts: { status?: InvoiceStatus; q?: string; limit?: number } = {}) {
  const filters: (SQL | undefined)[] = [];
  if (opts.status) filters.push(eq(invoices.status, opts.status));
  if (opts.q) {
    const term = `%${opts.q}%`;
    filters.push(
      or(
        ilike(invoices.invoiceNumber, term),
        ilike(invoices.vendorName, term),
        ilike(invoices.fileName, term),
        ilike(invoices.poNumber, term),
      ),
    );
  }
  return db
    .select(invoiceListColumns)
    .from(invoices)
    .leftJoin(vendors, eq(vendors.id, invoices.vendorId))
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getDashboardStats() {
  const rows = await db
    .select({
      status: invoices.status,
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${invoices.total}), 0)::float`,
    })
    .from(invoices)
    .groupBy(invoices.status);

  const [top] = await db
    .select({ currency: invoices.currency })
    .from(invoices)
    .where(sql`${invoices.currency} is not null`)
    .groupBy(invoices.currency)
    .orderBy(sql`count(*) desc`)
    .limit(1);

  const by = (s: InvoiceStatus) => rows.find((r) => r.status === s) ?? { count: 0, value: 0 };
  const total = rows.reduce((s, r) => s + r.count, 0);
  const decided = by("verified").count + by("flagged").count + by("rejected").count;
  return {
    currency: top?.currency ?? "INR",
    total,
    verified: by("verified"),
    flagged: by("flagged"),
    rejected: by("rejected"),
    processing: by("processing").count + by("failed").count,
    catchRate: decided === 0 ? 0 : (by("flagged").count + by("rejected").count) / decided,
  };
}

export type DailyVolume = { day: string; verified: number; flagged: number; rejected: number };

export async function getDailyVolume(days = 30): Promise<DailyVolume[]> {
  const since = subDays(new Date(), days - 1);
  since.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${invoices.createdAt}), 'YYYY-MM-DD')`,
      status: invoices.status,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(gte(invoices.createdAt, since))
    .groupBy(sql`1`, invoices.status);

  return Array.from({ length: days }, (_, i) => {
    const day = format(subDays(new Date(), days - 1 - i), "yyyy-MM-dd");
    const pick = (s: InvoiceStatus) => rows.find((r) => r.day === day && r.status === s)?.count ?? 0;
    return { day, verified: pick("verified"), flagged: pick("flagged"), rejected: pick("rejected") };
  });
}

/** Which checks trip most often — tells the team where fraud attempts come from. */
export async function getTopRiskSignals(limit = 6) {
  const rows = await db.execute<{ label: string; failed: number; warned: number }>(sql`
    select c->>'label' as label,
           count(*) filter (where c->>'status' = 'fail')::int as failed,
           count(*) filter (where c->>'status' = 'warn')::int as warned
    from ${invoices}, jsonb_array_elements(${invoices.checks}) c
    where c->>'status' in ('fail', 'warn')
    group by 1
    order by count(*) desc
    limit ${limit}
  `);
  return [...rows];
}

export async function listVendors() {
  return db
    .select({
      vendor: vendors,
      invoiceCount: sql<number>`(select count(*)::int from ${invoices} where ${invoices.vendorId} = ${vendors.id})`,
      verifiedValue: sql<number>`(select coalesce(sum(${invoices.total}), 0)::float from ${invoices} where ${invoices.vendorId} = ${vendors.id} and ${invoices.status} = 'verified')`,
    })
    .from(vendors)
    .orderBy(vendors.name);
}

export async function listPurchaseOrders() {
  return db
    .select({
      po: purchaseOrders,
      vendorName: vendors.name,
      billed: sql<number>`(select coalesce(sum(${invoices.total}), 0)::float from ${invoices} where ${invoices.purchaseOrderId} = ${purchaseOrders.id} and ${invoices.status} = 'verified')`,
      invoiceCount: sql<number>`(select count(*)::int from ${invoices} where ${invoices.purchaseOrderId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .orderBy(desc(purchaseOrders.issuedOn));
}
