import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export type InvoiceSpec = {
  vendor: {
    name: string;
    address: string;
    taxId: string | null;
    email: string | null;
    phone?: string;
  };
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string | null;
  poNumber: string | null;
  items: { description: string; quantity: number; unitPrice: number }[];
  taxRate: number; // e.g. 0.18
  /** Override the printed amounts to simulate tampering. */
  printed?: { subtotal?: number; tax?: number; total?: number };
  bank: { name: string; account: string; routing: string } | null;
  remarks?: string;
  accent?: [number, number, number];
};

const BUYER = [
  "Acme Procurement Pvt Ltd",
  "4th Floor, Prestige Tech Park",
  "Outer Ring Road, Bengaluru 560103",
  "GSTIN 29AAACA4321K1Z3",
];

function money(n: number) {
  return `INR ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function totals(spec: InvoiceSpec) {
  const subtotal = spec.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = Math.round(subtotal * spec.taxRate * 100) / 100;
  return {
    subtotal: spec.printed?.subtotal ?? subtotal,
    tax: spec.printed?.tax ?? tax,
    total: spec.printed?.total ?? Math.round((subtotal + tax) * 100) / 100,
  };
}

export async function renderInvoicePdf(spec: InvoiceSpec) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${spec.invoiceNumber}`);
  pdf.setAuthor(spec.vendor.name);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(...(spec.accent ?? [0.15, 0.35, 0.7]));
  const ink = rgb(0.12, 0.13, 0.16);
  const muted = rgb(0.42, 0.44, 0.48);
  const line = rgb(0.86, 0.87, 0.9);
  const { width, height } = page.getSize();
  const M = 48;

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    y: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    const w = font.widthOfTextAtSize(s, size);
    p.drawText(s, { x: opts.align === "right" ? x - w : x, y, font, size, color: opts.color ?? ink });
  };

  // Header band
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: accent });
  text(page, spec.vendor.name, M, height - 62, { font: bold, size: 17 });
  let y = height - 80;
  for (const l of spec.vendor.address.split("\n")) {
    text(page, l, M, y, { color: muted });
    y -= 13;
  }
  if (spec.vendor.taxId) {
    text(page, `GSTIN: ${spec.vendor.taxId}`, M, y, { color: muted });
    y -= 13;
  }
  if (spec.vendor.email)
    text(page, spec.vendor.email + (spec.vendor.phone ? `  ·  ${spec.vendor.phone}` : ""), M, y, { color: muted });

  text(page, "TAX INVOICE", width - M, height - 62, { font: bold, size: 20, color: accent, align: "right" });
  const meta: [string, string][] = [
    ["Invoice no.", spec.invoiceNumber],
    ["Invoice date", formatDate(spec.invoiceDate)],
    ...(spec.dueDate ? ([["Due date", formatDate(spec.dueDate)]] as [string, string][]) : []),
    ...(spec.poNumber ? ([["PO reference", spec.poNumber]] as [string, string][]) : []),
  ];
  let my = height - 86;
  for (const [k, v] of meta) {
    text(page, k, width - M - 150, my, { color: muted });
    text(page, v, width - M, my, { font: bold, align: "right" });
    my -= 14;
  }

  // Bill to
  y = height - 190;
  page.drawLine({ start: { x: M, y: y + 18 }, end: { x: width - M, y: y + 18 }, thickness: 0.8, color: line });
  text(page, "BILL TO", M, y, { font: bold, size: 8, color: muted });
  y -= 15;
  for (const [i, l] of BUYER.entries()) {
    text(page, l, M, y, { font: i === 0 ? bold : regular, color: i === 0 ? ink : muted });
    y -= 13;
  }

  // Items table
  y -= 22;
  const cols = { desc: M + 10, qty: width - M - 190, rate: width - M - 100, amt: width - M - 10 };
  page.drawRectangle({ x: M, y: y - 7, width: width - 2 * M, height: 24, color: rgb(0.95, 0.96, 0.97) });
  text(page, "Description", cols.desc, y + 1, { font: bold, size: 8.5, color: muted });
  text(page, "Qty", cols.qty, y + 1, { font: bold, size: 8.5, color: muted, align: "right" });
  text(page, "Rate", cols.rate, y + 1, { font: bold, size: 8.5, color: muted, align: "right" });
  text(page, "Amount", cols.amt, y + 1, { font: bold, size: 8.5, color: muted, align: "right" });
  y -= 26;
  for (const item of spec.items) {
    text(page, item.description, cols.desc, y);
    text(page, String(item.quantity), cols.qty, y, { align: "right" });
    text(page, money(item.unitPrice), cols.rate, y, { align: "right" });
    text(page, money(item.quantity * item.unitPrice), cols.amt, y, { align: "right" });
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: line });
    y -= 14;
  }

  // Totals
  const t = totals(spec);
  y -= 6;
  const rows: [string, string, boolean][] = [
    ["Subtotal", money(t.subtotal), false],
    [`GST @ ${Math.round(spec.taxRate * 100)}%`, money(t.tax), false],
    ["Total payable", money(t.total), true],
  ];
  for (const [k, v, strong] of rows) {
    if (strong) {
      page.drawRectangle({ x: width - M - 230, y: y - 8, width: 230, height: 24, color: accent });
      text(page, k, width - M - 220, y, { font: bold, color: rgb(1, 1, 1) });
      text(page, v, cols.amt, y, { font: bold, color: rgb(1, 1, 1), align: "right" });
    } else {
      text(page, k, width - M - 220, y, { color: muted });
      text(page, v, cols.amt, y, { align: "right" });
    }
    y -= 20;
  }

  // Bank details
  y -= 24;
  if (spec.bank) {
    page.drawRectangle({ x: M, y: y - 58, width: 280, height: 74, borderColor: line, borderWidth: 0.8 });
    text(page, "PAYMENT DETAILS", M + 12, y, { font: bold, size: 8, color: muted });
    const bankRows: [string, string][] = [
      ["Bank", spec.bank.name],
      ["Account no.", spec.bank.account],
      ["IFSC", spec.bank.routing],
    ];
    let by = y - 17;
    for (const [k, v] of bankRows) {
      text(page, k, M + 12, by, { color: muted });
      text(page, v, M + 90, by, { font: bold });
      by -= 14;
    }
    y -= 84;
  }

  if (spec.remarks) {
    text(page, "NOTES", M, y, { font: bold, size: 8, color: muted });
    y -= 14;
    for (const l of wrap(spec.remarks, regular, 9.5, width - 2 * M)) {
      text(page, l, M, y);
      y -= 13;
    }
  }

  // Footer
  page.drawLine({ start: { x: M, y: 70 }, end: { x: width - M, y: 70 }, thickness: 0.5, color: line });
  text(page, "This is a computer generated invoice.", M, 54, { size: 8, color: muted });
  text(page, `For ${spec.vendor.name}`, width - M, 54, { size: 8, color: muted, align: "right" });

  return Buffer.from(await pdf.save());
}

function wrap(s: string, font: PDFFont, size: number, max: number) {
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
