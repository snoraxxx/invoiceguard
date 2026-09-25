# InvoiceGuard

AI-assisted invoice authentication for procurement teams. Upload an invoice and an agent (OpenAI `gpt-6-luna`) reads it, cross-checks it against your vendor registry, purchase orders and invoice history, investigates anything odd, and decides whether it's safe to pay.

## Features

- **Dashboard**: verified / needs-review / rejected counts and value, 30-day outcome chart, most frequent risk signals, and tabbed lists of recent invoices.
- **Upload & verify**: drag in several PDFs or images at once and watch each one stream through the pipeline live.
- **Invoice detail**: risk score, agent summary and findings, every rule check, extracted fields compared with the registry (a changed bank account shows in red), line items, the original document, and the agent's tool calls.
- **Human review**: approve or reject with a required note, send back to review, re-analyze after updating the registry, add notes. Every action goes into an audit trail.
- **Vendor registry**: tax IDs and registered bank accounts that invoices are checked against. You can block a vendor.
- **Purchase orders**: invoices must quote an open PO for the same vendor and stay within its remaining balance.
- **CSV export**, dark mode and responsive layout.

## How verification works

```
upload ─▶ 1. Read document ─▶ 2. Rule checks ─▶ 3. Agent investigation ─▶ 4. Decision
          (LLM, structured     (deterministic,    (LLM + tools: vendor       (stricter signal
           output + forensic    Postgres)          profile, invoice history,  wins)
           observations)                           PO lookup, vendor search)
```

**Rule checks** (`src/lib/agent/checks.ts`). Each failed check adds risk points.

| Check                | Fails when                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| Document type        | the file isn't an invoice                                                         |
| Approved vendor      | vendor is unknown, blocked, or a look-alike of a registered name                  |
| Tax registration     | the tax ID differs from the registry                                              |
| Bank details         | the pay-to account or routing code differs from the registry                      |
| Duplicate submission | same file hash, same vendor + invoice number, or same vendor + amount + date      |
| Totals add up        | qty × rate, line sum, subtotal + tax and total don't reconcile                    |
| Purchase order match | PO is missing, unknown, closed, for another vendor, or over its remaining balance |
| Dates are plausible  | the invoice is future-dated, very old, due before issue, or predates the PO       |

**Decision** (`src/lib/agent/pipeline.ts`): `risk = max(rule score, agent score)`.

- **Rejected**: risk ≥ 70, or a hard failure (exact duplicate, blocked vendor, not an invoice).
- **Needs review**: risk ≥ 30, or any failed check.
- **Verified**: everything else.

A reviewer can override any decision.

## Getting started

Requirements: Node 20+, pnpm, and Postgres 14+ (or Docker).

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and OPENAI_API_KEY
docker compose up -d          # optional: local Postgres on :5432
pnpm db:push                  # create tables
pnpm db:seed                  # demo vendors, POs, 30 days of history + ./samples
pnpm dev
```

Open http://localhost:3000.

> `pnpm db:seed` **wipes all tables** before seeding.

### Try the sample invoices

The seed script writes six PDFs to `./samples`. Upload them to see each check fire:

| File                                   | What should happen                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `01-genuine-northwind.pdf`             | Verified                                                                                |
| `02-bank-details-changed-bluepeak.pdf` | Bank account changed + urgency language → rejected / review                             |
| `03-inflated-total-meridian.pdf`       | Printed total doesn't match line items → review                                         |
| `04-lookalike-vendor.pdf`              | "Northwnd Office Suplies" impersonating Northwind, different tax ID and bank → rejected |
| `05-duplicate-crestline.pdf`           | Re-uses an invoice number already billed → rejected                                     |
| `06-exceeds-po-sparrow.pdf`            | Bills more than the PO has left → review                                                |

Seeded history invoices were decided by rule checks only. Press **Re-analyze** on one to get the agent's review.

## Configuration

| Variable                  | Default      |                                                                   |
| ------------------------- | ------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`            | —            | Postgres connection string                                        |
| `OPENAI_API_KEY`          | —            | Required for uploads and re-analysis                              |
| `OPENAI_MODEL`            | `gpt-6-luna` | Any Responses-API model with vision, structured outputs and tools |
| `OPENAI_REASONING_EFFORT` | `low`        | `none` / `low` / `medium` / `high`                                |

## Project layout

```
src/
  app/                      pages (dashboard, upload, invoices, vendors, purchase-orders)
    api/invoices/           upload + NDJSON progress stream, re-analyze, file download, CSV export
    actions.ts              server actions (review decisions, vendors, POs)
  lib/agent/
    extract.ts              document → structured fields (vision + structured outputs)
    checks.ts               deterministic rule engine
    review.ts               tool-using review agent
    pipeline.ts             orchestration, scoring, persistence
  db/schema.ts              Drizzle schema (files are stored in Postgres as bytea)
  components/               UI (hand-rolled shadcn-style components on Radix)
scripts/seed.ts             demo data + sample PDFs
```

## Scope notes

This is intentionally a mini project:

- There is no authentication; every reviewer is "Reviewer".
- Dashboard totals assume one base currency (the most common one on file).
- Uploaded files are stored in Postgres, which is fine for thousands of invoices but not millions.
