# ProcureMind

AI-assisted invoice authentication for procurement teams. Upload an invoice and an agent (OpenAI `gpt-6-luna`) reads it, cross-checks it against your vendor registry, purchase orders, goods received and invoice history, investigates anything odd, and decides whether it's safe to pay.

Runs on Cloudflare Workers with Postgres (PlanetScale).

## Features

- **Dashboard**: verified / needs-review / rejected counts and value, 30-day outcome chart, most frequent risk signals, and tabbed lists of recent invoices.
- **Upload & verify**: drag in several PDFs or images at once and watch each one stream through the pipeline live.
- **Invoice detail**: risk score, agent summary and findings, every rule check, extracted fields compared with the registry (a changed bank account shows in red), line items, the original document, and the agent's tool calls.
- **Human review**: approve or reject with a required note, send back to review, re-analyze after updating the registry, add notes. Every action goes into an audit trail.
- **Vendor registry**: tax IDs and registered bank accounts that invoices are checked against. You can block a vendor.
- **Purchase orders**: invoices must quote an open PO for the same vendor and stay within its remaining balance.
- **Inventory**: a catalogue of stock items and every delivery logged at the warehouse (goods received notes). Invoices are matched line by line against goods actually received, which is how a **first-time supplier** that isn't in the registry yet gets verified. Shows which deliveries are still awaiting an invoice and which items are below their reorder level.
- **CSV export**, dark mode and responsive layout.

## How verification works

```
upload ─▶ 1. Read document ─▶ 2. Rule checks ─▶ 3. Agent investigation ─▶ 4. Decision
          (LLM, structured     (deterministic,    (LLM + tools: vendor       (stricter signal
           output + forensic    Postgres)          profile, invoice history,  wins)
           observations)                           PO lookup, vendor search,
                                                   goods received)
```

**Rule checks** (`src/lib/agent/checks.ts`). Each failed check adds risk points.

| Check                | Fails when                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document type        | the file isn't an invoice                                                                                                                                 |
| Approved vendor      | vendor is blocked, a look-alike of a registered name, or unknown and not backed by goods received                                                         |
| Tax registration     | the tax ID differs from the registry                                                                                                                      |
| Bank details         | the pay-to account or routing code differs from the registry                                                                                              |
| Duplicate submission | same file hash, same vendor + invoice number, or same vendor + amount + date                                                                              |
| Totals add up        | qty × rate, line sum, subtotal + tax and total don't reconcile                                                                                            |
| Goods received       | the invoice bills items we never received, more units than received, or above the delivered cost; or the tax ID differs from the one recorded at delivery |
| Purchase order match | PO is missing, unknown, closed, for another vendor, or over its remaining balance                                                                         |
| Dates are plausible  | the invoice is future-dated, very old, due before issue, or predates the PO                                                                               |

**New suppliers.** A supplier that isn't in the vendor registry can't be checked on tax ID or bank account, so the invoice is matched against deliveries from that supplier in the last 180 days instead (`src/lib/agent/receipts.ts`). The supplier is identified by tax ID, or by name when no tax ID was recorded. Each invoice line is matched to a delivered item by description, and quantity and price are then compared with what arrived. A delivery counts as billed once a verified or pending-review invoice has matched it, so the same goods can't be invoiced twice. If every line matches, the invoice can be verified, with a reminder to register the supplier and confirm their bank details before the first payment. The invoice page has a **Register supplier** button that pre-fills the vendor form from the invoice.

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
pnpm db:seed                  # demo vendors, POs, inventory, 30 days of history + ./samples
pnpm dev
```

Open http://localhost:3000.

> `pnpm db:seed` **wipes all tables** before seeding.

### Try the sample invoices

The seed script writes ten PDFs to `./samples`. Upload them to see each check fire:

| File                                         | What should happen                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `01-genuine-northwind.pdf`                   | Verified                                                                                         |
| `02-bank-details-changed-bluepeak.pdf`       | Bank account changed + urgency language → rejected / review                                      |
| `03-inflated-total-meridian.pdf`             | Printed total doesn't match line items → review                                                  |
| `04-lookalike-vendor.pdf`                    | "Northwnd Office Suplies" impersonating Northwind, different tax ID and bank → rejected          |
| `05-duplicate-crestline.pdf`                 | Re-uses an invoice number already billed → rejected                                              |
| `06-exceeds-po-sparrow.pdf`                  | Bills more than the PO has left → review                                                         |
| `07-new-supplier-goods-received-lumen.pdf`   | New supplier, every line matches delivery GRN-2026-0315 → verified                               |
| `08-new-supplier-overbilled-kaveri.pdf`      | New supplier bills 80 helmets (50 received), vests never delivered, gloves above cost → rejected |
| `09-new-supplier-nothing-received-orbit.pdf` | New supplier, nothing ever received from them → rejected                                         |
| `10-impersonated-new-supplier-lumen.pdf`     | Claims to be Lumen but with a different tax ID than the one recorded at delivery → rejected      |

Seeded history invoices were decided by rule checks only. Press **Re-analyze** on one to get the agent's review.

## Deploying to Cloudflare Workers (with PlanetScale Postgres)

The app deploys as a single Worker through [OpenNext](https://opennext.js.org/cloudflare) and is live at https://procuremind.shreezvevoo.workers.dev. The database is PlanetScale Postgres. The Workers Paid plan ($5/month) is recommended because analysing an invoice can exceed the free plan's 10 ms CPU limit per request.

1. **Database.** Create the tables and (optionally) load the demo data from your machine:
   ```bash
   DATABASE_URL="<planetscale url>" pnpm db:push
   DATABASE_URL="<planetscale url>" pnpm db:seed   # wipes all tables
   ```
2. **Secrets.** Give the Worker its secrets (you'll be prompted for each value):
   ```bash
   pnpm wrangler login
   pnpm wrangler secret put DATABASE_URL     # the PlanetScale URL, with sslmode=verify-full
   pnpm wrangler secret put OPENAI_API_KEY
   ```
   `OPENAI_MODEL` and `OPENAI_REASONING_EFFORT` are plain vars in `wrangler.jsonc`.
3. **Deploy.**
   ```bash
   pnpm run deploy        # not `pnpm deploy`, which is a built-in pnpm command
   ```

To run the production build locally in the Workers runtime first, copy `.dev.vars.example` to `.dev.vars`, fill it in and run `pnpm preview`.

Notes on the build (`pnpm cf:build`):

- **Postgres driver.** `postgres` is a server-external package so the Worker gets postgres.js's Cloudflare build (TLS over `cloudflare:sockets`); its Node build can't upgrade a socket to TLS inside workerd. With pnpm, OpenNext would still pick the Node build, so `scripts/cf-fix-externals.mjs` repoints Turbopack's external links before OpenNext runs.
- **Secrets stay local.** `scripts/cf-strip-env.mjs` empties the `.env` values OpenNext would otherwise bundle into the Worker.
- **Connections.** Each request opens its own database connection (`src/db/index.ts`), because a Worker can't reuse a socket opened by another request. If connection latency becomes noticeable, put [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) in front of the database.

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
  app/                      pages (dashboard, upload, invoices, inventory, vendors, purchase-orders)
    api/invoices/           upload + NDJSON progress stream, re-analyze, file download, CSV export
    actions.ts              server actions (review decisions, vendors, POs, deliveries, stock items)
  lib/agent/
    extract.ts              document → structured fields (vision + structured outputs)
    checks.ts               deterministic rule engine
    receipts.ts             matching invoices against goods received
    review.ts               tool-using review agent
    pipeline.ts             orchestration, scoring, persistence
  db/schema.ts              Drizzle schema (files are stored in Postgres as bytea)
  components/               UI (hand-rolled shadcn-style components on Radix)
scripts/seed.ts             demo data + sample PDFs
wrangler.jsonc              Cloudflare Worker config
```

## Scope notes

This is intentionally a mini project:

- There is no authentication; every reviewer is "Reviewer".
- Dashboard totals assume one base currency (the most common one on file).
- Uploaded files are stored in Postgres, which is fine for thousands of invoices but not millions.
