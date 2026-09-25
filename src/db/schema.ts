import {
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AgentStep, CheckResult, Finding, LineItem } from "@/lib/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const vendorStatus = pgEnum("vendor_status", ["active", "blocked"]);
export const poStatus = pgEnum("po_status", ["open", "closed"]);
export const invoiceStatus = pgEnum("invoice_status", ["processing", "verified", "flagged", "rejected", "failed"]);
export const actor = pgEnum("actor", ["agent", "user", "system"]);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    email: text("email"),
    address: text("address"),
    bankName: text("bank_name"),
    bankAccount: text("bank_account"),
    bankRouting: text("bank_routing"),
    status: vendorStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vendors_tax_id_idx").on(t.taxId)],
);

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNumber: text("po_number").notNull().unique(),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  issuedOn: date("issued_on").notNull(),
  status: poStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: invoiceStatus("status").notNull().default("processing"),
    decidedBy: actor("decided_by"),
    riskScore: integer("risk_score"),

    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileSha256: text("file_sha256").notNull(),

    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),

    // Fields extracted from the document
    invoiceNumber: text("invoice_number"),
    vendorName: text("vendor_name"),
    vendorTaxId: text("vendor_tax_id"),
    vendorEmail: text("vendor_email"),
    vendorAddress: text("vendor_address"),
    bankName: text("bank_name"),
    bankAccount: text("bank_account"),
    bankRouting: text("bank_routing"),
    poNumber: text("po_number"),
    invoiceDate: date("invoice_date"),
    dueDate: date("due_date"),
    currency: text("currency"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2, mode: "number" }),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2, mode: "number" }),
    total: numeric("total", { precision: 14, scale: 2, mode: "number" }),
    lineItems: jsonb("line_items").$type<LineItem[]>().notNull().default([]),

    // Analysis output
    checks: jsonb("checks").$type<CheckResult[]>().notNull().default([]),
    findings: jsonb("findings").$type<Finding[]>().notNull().default([]),
    agentSteps: jsonb("agent_steps").$type<AgentStep[]>().notNull().default([]),
    summary: text("summary"),
    model: text("model"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_status_idx").on(t.status),
    index("invoices_created_at_idx").on(t.createdAt),
    index("invoices_sha_idx").on(t.fileSha256),
    index("invoices_vendor_number_idx").on(t.vendorId, t.invoiceNumber),
  ],
);

export const invoiceFiles = pgTable("invoice_files", {
  invoiceId: uuid("invoice_id")
    .primaryKey()
    .references(() => invoices.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

export const invoiceEvents = pgTable(
  "invoice_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    actor: actor("actor").notNull(),
    action: text("action").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_events_invoice_idx").on(t.invoiceId)],
);

export type Vendor = typeof vendors.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceEvent = typeof invoiceEvents.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
