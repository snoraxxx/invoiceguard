/**
 * Resets the database with a demo vendor registry, purchase orders and ~30 days of invoice history,
 * and writes a set of sample invoices to ./samples that exercise each fraud check when uploaded.
 *
 *   pnpm db:seed
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { format, subDays } from "date-fns";
import { sql } from "drizzle-orm";
import { db, invoiceEvents, invoiceFiles, invoices, purchaseOrders, vendors } from "@/db";
import { runChecks } from "@/lib/agent/checks";
import { decide } from "@/lib/agent/pipeline";
import { renderInvoicePdf, totals, type InvoiceSpec } from "./invoice-pdf";

const day = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const V = {
  northwind: {
    name: "Northwind Office Supplies Pvt Ltd",
    taxId: "29AABCN1234F1Z5",
    email: "billing@northwind-supplies.in",
    address: "12 Residency Road\nBengaluru, Karnataka 560025",
    bankName: "HDFC Bank",
    bankAccount: "50100234567890",
    bankRouting: "HDFC0001234",
    accent: [0.13, 0.4, 0.75] as [number, number, number],
  },
  bluepeak: {
    name: "Bluepeak Cloud Services LLP",
    taxId: "27AAKFB5678K1Z2",
    email: "accounts@bluepeak.cloud",
    address: "Level 9, One BKC\nMumbai, Maharashtra 400051",
    bankName: "ICICI Bank",
    bankAccount: "001205012345",
    bankRouting: "ICIC0000012",
    accent: [0.05, 0.55, 0.65] as [number, number, number],
  },
  meridian: {
    name: "Meridian Logistics Pvt Ltd",
    taxId: "07AAECM9012L1Z8",
    email: "invoices@meridianlogistics.co.in",
    address: "Plot 44, Okhla Industrial Area Phase II\nNew Delhi 110020",
    bankName: "State Bank of India",
    bankAccount: "38291047561",
    bankRouting: "SBIN0005678",
    accent: [0.2, 0.25, 0.35] as [number, number, number],
  },
  crestline: {
    name: "Crestline Facility Management",
    taxId: "29AAGFC3456M1Z1",
    email: "finance@crestlinefm.in",
    address: "88 Whitefield Main Road\nBengaluru, Karnataka 560066",
    bankName: "Axis Bank",
    bankAccount: "917020045678123",
    bankRouting: "UTIB0000456",
    accent: [0.45, 0.2, 0.55] as [number, number, number],
  },
  sparrow: {
    name: "Sparrow Print & Packaging",
    taxId: "33ABCFS7890N1Z4",
    email: "billing@sparrowpack.in",
    address: "21 Guindy Industrial Estate\nChennai, Tamil Nadu 600032",
    bankName: "Kotak Mahindra Bank",
    bankAccount: "7412589630",
    bankRouting: "KKBK0000789",
    accent: [0.75, 0.35, 0.1] as [number, number, number],
  },
  quantix: {
    name: "Quantix Components Ltd",
    taxId: "24AAACQ1122P1Z9",
    email: "ar@quantixcomponents.com",
    address: "Sector 11, GIDC\nGandhinagar, Gujarat 382010",
    bankName: "Bank of Baroda",
    bankAccount: "27450200001234",
    bankRouting: "BARB0GANDHI",
    accent: [0.3, 0.3, 0.3] as [number, number, number],
  },
};
type VendorKey = keyof typeof V;

function spec(
  key: VendorKey,
  o: Partial<InvoiceSpec> & Pick<InvoiceSpec, "invoiceNumber" | "invoiceDate" | "items">,
): InvoiceSpec {
  const v = V[key];
  return {
    vendor: { name: v.name, address: v.address, taxId: v.taxId, email: v.email },
    dueDate: null,
    poNumber: null,
    taxRate: 0.18,
    bank: { name: v.bankName, account: v.bankAccount, routing: v.bankRouting },
    accent: v.accent,
    ...o,
  };
}

// ~30 days of history. Days are "days ago".
const HISTORY: { daysAgo: number; key: VendorKey; spec: InvoiceSpec }[] = [
  {
    daysAgo: 29,
    key: "northwind",
    spec: spec("northwind", {
      invoiceNumber: "NW-2026-0341",
      invoiceDate: day(30),
      dueDate: day(0),
      poNumber: "PO-2026-0101",
      items: [
        { description: "A4 copier paper (box of 5 reams)", quantity: 60, unitPrice: 480 },
        { description: "Whiteboard markers, assorted (pack of 12)", quantity: 20, unitPrice: 360 },
      ],
    }),
  },
  {
    daysAgo: 27,
    key: "bluepeak",
    spec: spec("bluepeak", {
      invoiceNumber: "BP/26/0712",
      invoiceDate: day(28),
      dueDate: day(-2),
      poNumber: "PO-2026-0102",
      items: [
        { description: "Managed Kubernetes cluster - August", quantity: 1, unitPrice: 72000 },
        { description: "Object storage, 20 TB", quantity: 1, unitPrice: 28000 },
      ],
    }),
  },
  {
    daysAgo: 26,
    key: "meridian",
    spec: spec("meridian", {
      invoiceNumber: "ML-7781",
      invoiceDate: day(27),
      dueDate: day(-3),
      poNumber: "PO-2026-0103",
      items: [{ description: "FTL freight Bengaluru to Delhi", quantity: 2, unitPrice: 27500 }],
    }),
  },
  {
    daysAgo: 24,
    key: "crestline",
    spec: spec("crestline", {
      invoiceNumber: "CFM-2026-088",
      invoiceDate: day(25),
      dueDate: day(-5),
      poNumber: "PO-2026-0104",
      items: [
        { description: "Housekeeping services - August", quantity: 1, unitPrice: 95000 },
        { description: "HVAC preventive maintenance", quantity: 1, unitPrice: 25000 },
      ],
    }),
  },
  {
    daysAgo: 22,
    key: "sparrow",
    spec: spec("sparrow", {
      invoiceNumber: "SPP-1102",
      invoiceDate: day(23),
      dueDate: day(-7),
      poNumber: "PO-2026-0105",
      items: [
        { description: "Corrugated shipping boxes, 3-ply", quantity: 5000, unitPrice: 18.5 },
        { description: "Printed product sleeves", quantity: 2000, unitPrice: 17.25 },
      ],
    }),
  },
  {
    daysAgo: 20,
    key: "northwind",
    spec: spec("northwind", {
      invoiceNumber: "NW-2026-0367",
      invoiceDate: day(21),
      dueDate: day(-9),
      poNumber: "PO-2026-0101",
      items: [{ description: "Ergonomic office chairs", quantity: 6, unitPrice: 8900 }],
    }),
  },
  {
    daysAgo: 18,
    key: "northwind",
    spec: {
      ...spec("northwind", {
        invoiceNumber: "ADS-0093",
        invoiceDate: day(19),
        dueDate: day(16),
        items: [{ description: "Data migration consulting", quantity: 40, unitPrice: 2500 }],
      }),
      vendor: {
        name: "Apex Data Solutions",
        address: "Unit 5, Cyber Towers\nHyderabad 500081",
        taxId: "36AAPFA1111Q1Z0",
        email: "pay@apexdata-solutions.com",
      },
      bank: { name: "Yes Bank", account: "018763300004521", routing: "YESB0000187" },
    },
  },
  {
    daysAgo: 16,
    key: "bluepeak",
    spec: spec("bluepeak", {
      invoiceNumber: "BP/26/0768",
      invoiceDate: day(17),
      dueDate: day(-13),
      poNumber: "PO-2026-0102",
      items: [
        { description: "Managed Kubernetes cluster - September", quantity: 1, unitPrice: 72000 },
        { description: "Object storage, 20 TB", quantity: 1, unitPrice: 28000 },
      ],
    }),
  },
  {
    daysAgo: 14,
    key: "meridian",
    spec: {
      ...spec("meridian", {
        invoiceNumber: "ML-7802",
        invoiceDate: day(15),
        dueDate: day(12),
        poNumber: "PO-2026-0103",
        items: [{ description: "FTL freight Bengaluru to Pune", quantity: 3, unitPrice: 21000 }],
        remarks: "Kindly remit to our new collection account shown on this invoice.",
      }),
      bank: { name: "IndusInd Bank", account: "259876543210", routing: "INDB0000321" },
    },
  },
  {
    daysAgo: 12,
    key: "crestline",
    spec: spec("crestline", {
      invoiceNumber: "CFM-2026-091",
      invoiceDate: day(13),
      dueDate: day(-17),
      poNumber: "PO-2026-0104",
      items: [{ description: "Housekeeping services - September (part)", quantity: 1, unitPrice: 48000 }],
    }),
  },
  {
    daysAgo: 10,
    key: "quantix",
    spec: spec("quantix", {
      invoiceNumber: "QC-5521",
      invoiceDate: day(11),
      dueDate: day(4),
      items: [{ description: "PCB assemblies, rev C", quantity: 150, unitPrice: 740 }],
    }),
  },
  {
    daysAgo: 8,
    key: "northwind",
    spec: spec("northwind", {
      invoiceNumber: "NW-2026-0341",
      invoiceDate: day(9),
      dueDate: day(-21),
      poNumber: "PO-2026-0101",
      items: [
        { description: "A4 copier paper (box of 5 reams)", quantity: 60, unitPrice: 480 },
        { description: "Whiteboard markers, assorted (pack of 12)", quantity: 20, unitPrice: 360 },
      ],
    }),
  },
  {
    daysAgo: 6,
    key: "meridian",
    spec: spec("meridian", {
      invoiceNumber: "ML-7820",
      invoiceDate: day(7),
      dueDate: day(-23),
      poNumber: "PO-2026-0103",
      items: [{ description: "LTL freight, Chennai hub", quantity: 4, unitPrice: 9800 }],
    }),
  },
  {
    daysAgo: 5,
    key: "bluepeak",
    spec: spec("bluepeak", {
      invoiceNumber: "BP/26/0791",
      invoiceDate: day(6),
      dueDate: day(-24),
      poNumber: "PO-2026-0102",
      items: [{ description: "Premium support add-on", quantity: 1, unitPrice: 18000 }],
    }),
  },
  {
    daysAgo: 3,
    key: "crestline",
    spec: spec("crestline", {
      invoiceNumber: "CFM-2026-095",
      invoiceDate: day(4),
      dueDate: day(-26),
      items: [{ description: "Emergency plumbing call-out", quantity: 1, unitPrice: 6500 }],
    }),
  },
  {
    daysAgo: 2,
    key: "northwind",
    spec: spec("northwind", {
      invoiceNumber: "NW-2026-0389",
      invoiceDate: day(3),
      dueDate: day(-27),
      poNumber: "PO-2026-0101",
      items: [{ description: "Printer toner cartridges", quantity: 12, unitPrice: 3200 }],
    }),
  },
  {
    daysAgo: 1,
    key: "sparrow",
    spec: spec("sparrow", {
      invoiceNumber: "SPP-1120",
      invoiceDate: day(2),
      dueDate: day(-28),
      poNumber: "PO-2026-0105",
      items: [{ description: "Bubble wrap rolls", quantity: 40, unitPrice: 650 }],
      printed: { total: 38680 },
    }),
  },
];

// Fresh invoices to upload through the UI - each one exercises a different check.
const SAMPLES: { file: string; spec: InvoiceSpec }[] = [
  {
    file: "01-genuine-northwind.pdf",
    spec: spec("northwind", {
      invoiceNumber: "NW-2026-0402",
      invoiceDate: day(1),
      dueDate: day(-29),
      poNumber: "PO-2026-0101",
      items: [
        { description: "A4 copier paper (box of 5 reams)", quantity: 40, unitPrice: 480 },
        { description: "Desk organisers", quantity: 25, unitPrice: 540 },
      ],
    }),
  },
  {
    file: "02-bank-details-changed-bluepeak.pdf",
    spec: {
      ...spec("bluepeak", {
        invoiceNumber: "BP/26/0803",
        invoiceDate: day(0),
        dueDate: day(-1),
        poNumber: "PO-2026-0102",
        items: [
          { description: "Managed Kubernetes cluster - October", quantity: 1, unitPrice: 72000 },
          { description: "Object storage, 20 TB", quantity: 1, unitPrice: 28000 },
        ],
        remarks:
          "IMPORTANT: Due to an ongoing audit our ICICI account is temporarily frozen. Please make this and all future payments to the new account shown on this invoice. Payment is urgent to avoid service suspension.",
      }),
      bank: { name: "RBL Bank", account: "409001234987", routing: "RATN0000456" },
    },
  },
  {
    file: "03-inflated-total-meridian.pdf",
    spec: spec("meridian", {
      invoiceNumber: "ML-7841",
      invoiceDate: day(1),
      dueDate: day(-29),
      poNumber: "PO-2026-0103",
      items: [
        { description: "FTL freight Bengaluru to Hyderabad", quantity: 2, unitPrice: 24000 },
        { description: "Loading / unloading charges", quantity: 2, unitPrice: 3500 },
      ],
      printed: { total: 94900 },
    }),
  },
  {
    file: "04-lookalike-vendor.pdf",
    spec: {
      ...spec("northwind", {
        invoiceNumber: "NWS-1187",
        invoiceDate: day(1),
        dueDate: day(-6),
        items: [{ description: "Office stationery bundle", quantity: 1, unitPrice: 184000 }],
      }),
      vendor: {
        name: "Northwnd Office Suplies Pvt Ltd",
        address: "Flat 3B, 7th Cross\nBengaluru 560034",
        taxId: "29AABCN9876F1Z1",
        email: "billing@northwnd-supplies.com",
      },
      bank: { name: "Punjab National Bank", account: "0123000456789", routing: "PUNB0012300" },
    },
  },
  {
    file: "05-duplicate-crestline.pdf",
    spec: spec("crestline", {
      invoiceNumber: "CFM-2026-091",
      invoiceDate: day(0),
      dueDate: day(-30),
      poNumber: "PO-2026-0104",
      items: [{ description: "Housekeeping services - September (balance)", quantity: 1, unitPrice: 47000 }],
    }),
  },
  {
    file: "06-exceeds-po-sparrow.pdf",
    spec: spec("sparrow", {
      invoiceNumber: "SPP-1131",
      invoiceDate: day(0),
      dueDate: day(-30),
      poNumber: "PO-2026-0105",
      items: [{ description: "Printed gift boxes, rigid", quantity: 1200, unitPrice: 68 }],
    }),
  },
];

async function main() {
  console.log("Resetting tables…");
  await db.execute(sql`truncate ${invoiceEvents}, ${invoiceFiles}, ${invoices}, ${purchaseOrders}, ${vendors} cascade`);

  const vendorIds = {} as Record<VendorKey, string>;
  for (const [key, v] of Object.entries(V) as [VendorKey, (typeof V)[VendorKey]][]) {
    const [row] = await db
      .insert(vendors)
      .values({
        name: v.name,
        taxId: v.taxId,
        email: v.email,
        address: v.address.replace("\n", ", "),
        bankName: v.bankName,
        bankAccount: v.bankAccount,
        bankRouting: v.bankRouting,
        status: key === "quantix" ? "blocked" : "active",
        notes:
          key === "quantix" ? "Blocked in June 2026 after a quality dispute and repeated duplicate billing." : null,
      })
      .returning({ id: vendors.id });
    vendorIds[key] = row.id;
  }
  console.log(`  ${Object.keys(vendorIds).length} vendors`);

  const pos = [
    {
      poNumber: "PO-2026-0090",
      vendorId: vendorIds.northwind,
      amount: 100000,
      issuedOn: day(200),
      status: "closed" as const,
      description: "Office supplies H1 FY26",
    },
    {
      poNumber: "PO-2026-0101",
      vendorId: vendorIds.northwind,
      amount: 300000,
      issuedOn: day(85),
      description: "Office supplies H2 FY26",
    },
    {
      poNumber: "PO-2026-0102",
      vendorId: vendorIds.bluepeak,
      amount: 1200000,
      issuedOn: day(175),
      description: "Cloud hosting - annual commitment",
    },
    {
      poNumber: "PO-2026-0103",
      vendorId: vendorIds.meridian,
      amount: 500000,
      issuedOn: day(80),
      description: "Outbound freight Q3",
    },
    {
      poNumber: "PO-2026-0104",
      vendorId: vendorIds.crestline,
      amount: 600000,
      issuedOn: day(100),
      description: "Facility management FY26",
    },
    {
      poNumber: "PO-2026-0105",
      vendorId: vendorIds.sparrow,
      amount: 200000,
      issuedOn: day(55),
      description: "Packaging material Q3",
    },
  ];
  await db.insert(purchaseOrders).values(pos);
  console.log(`  ${pos.length} purchase orders`);

  for (const h of HISTORY) {
    const data = await renderInvoicePdf(h.spec);
    const sha = createHash("sha256").update(data).digest("hex");
    const t = totals(h.spec);
    const createdAt = subDays(new Date(), h.daysAgo);
    createdAt.setHours(9 + (h.daysAgo % 8), (h.daysAgo * 7) % 60);
    const [inv] = await db
      .insert(invoices)
      .values({
        fileName: `${h.spec.invoiceNumber.replace(/\//g, "-")}.pdf`,
        mimeType: "application/pdf",
        fileSize: data.length,
        fileSha256: sha,
        createdAt,
      })
      .returning({ id: invoices.id });
    await db.insert(invoiceFiles).values({ invoiceId: inv.id, data });

    const lineItems = h.spec.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      amount: i.quantity * i.unitPrice,
    }));
    const facts = {
      id: inv.id,
      fileSha256: sha,
      isInvoice: true,
      documentType: "tax invoice",
      invoiceNumber: h.spec.invoiceNumber,
      vendorName: h.spec.vendor.name,
      vendorTaxId: h.spec.vendor.taxId,
      bankAccount: h.spec.bank?.account ?? null,
      bankRouting: h.spec.bank?.routing ?? null,
      poNumber: h.spec.poNumber,
      invoiceDate: h.spec.invoiceDate,
      dueDate: h.spec.dueDate,
      currency: "INR",
      subtotal: t.subtotal,
      taxAmount: t.tax,
      total: t.total,
      lineItems,
    };
    const { checks, vendor, purchaseOrder, ruleScore } = await runChecks(facts);
    const { status, riskScore } = decide(checks, ruleScore, null);
    await db
      .update(invoices)
      .set({
        status,
        riskScore,
        decidedBy: "system",
        vendorId: vendor?.id ?? null,
        purchaseOrderId: purchaseOrder?.id ?? null,
        invoiceNumber: facts.invoiceNumber,
        vendorName: facts.vendorName,
        vendorTaxId: facts.vendorTaxId,
        vendorEmail: h.spec.vendor.email,
        vendorAddress: h.spec.vendor.address.replace("\n", ", "),
        bankName: h.spec.bank?.name ?? null,
        bankAccount: facts.bankAccount,
        bankRouting: facts.bankRouting,
        poNumber: facts.poNumber,
        invoiceDate: facts.invoiceDate,
        dueDate: facts.dueDate,
        currency: "INR",
        subtotal: t.subtotal,
        taxAmount: t.tax,
        total: t.total,
        lineItems,
        checks,
        analyzedAt: createdAt,
        updatedAt: createdAt,
      })
      .where(sql`${invoices.id} = ${inv.id}`);
    await db.insert(invoiceEvents).values([
      { invoiceId: inv.id, actor: "user", action: "uploaded", message: "Imported by the seed script", createdAt },
      {
        invoiceId: inv.id,
        actor: "system",
        action: status,
        message: `Rule checks only - risk ${riskScore}/100.`,
        createdAt,
      },
    ]);
    console.log(`  ${h.spec.invoiceNumber.padEnd(14)} ${status.padEnd(9)} risk ${riskScore}`);
  }

  const dir = path.join(process.cwd(), "samples");
  await mkdir(dir, { recursive: true });
  for (const s of SAMPLES) await writeFile(path.join(dir, s.file), await renderInvoicePdf(s.spec));
  console.log(`\nWrote ${SAMPLES.length} sample invoices to ./samples - upload them to see the agent at work.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
