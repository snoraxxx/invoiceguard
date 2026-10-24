/**
 * Runs the full pipeline (extraction → rule checks → agent review → decision) on every PDF in
 * ./samples, against a freshly seeded database, and writes per-invoice results as JSON.
 * Uses real model calls. Wipes the database configured in DATABASE_URL on every trial.
 *
 *   tsx scripts/evaluate.ts [trials=3] [out=eval-results.json]
 */
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, invoices } from "@/db";
import { createInvoiceFromUpload, analyzeInvoice, decide } from "@/lib/agent/pipeline";
import { normalizeId } from "@/lib/match";
import type { AnalysisEvent, CheckResult } from "@/lib/types";

const trials = Number(process.argv[2] ?? 3);
const out = process.argv[3] ?? "eval-results.json";
const dir = path.join(process.cwd(), "samples");

/** Fields as printed on the PDF, read with pdftotext, to score extraction against. */
function printed(file: string) {
  const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  const amount = (s: string | null) => (s ? Number(s.replace(/,/g, "")) : null);
  const lines = text.split("\n").filter((l) => /INR [\d,]+\.\d\d\s+INR [\d,]+\.\d\d\s*$/.test(l)).length;
  return {
    invoiceNumber: grab(/Invoice no\.\s+(\S+)/),
    taxId: grab(/GSTIN:\s*(\S+)/),
    poNumber: grab(/PO reference\s+(\S+)/),
    total: amount(grab(/Total payable\s+INR ([\d,]+\.\d\d)/)),
    bankAccount: grab(/Account no\.\s+(\S+)/),
    lineCount: lines,
  };
}

async function main() {
  const results: unknown[] = [];

  for (let trial = 1; trial <= trials; trial++) {
    console.log(`\nTrial ${trial}/${trials}: seeding…`);
    const seed = spawnSync("pnpm", ["-s", "db:seed"], { stdio: "ignore" });
    if (seed.status !== 0) throw new Error("Seeding failed");

    const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf")).sort();
    for (const file of files) {
      const full = path.join(dir, file);
      const data = await readFile(full);
      const id = await createInvoiceFromUpload(new File([data], file, { type: "application/pdf" }));

      const t0 = performance.now();
      const stageStart: Record<string, number> = {};
      const stageMs: Record<string, number> = {};
      const tools: string[] = [];
      let agentVerdict: string | null = null;
      let error: string | null = null;
      await analyzeInvoice(id, (e: AnalysisEvent) => {
        const now = performance.now();
        if (e.type === "stage" && e.state === "running") stageStart[e.stage] = now;
        if (e.type === "stage" && e.state === "done") {
          stageMs[e.stage] = Math.round(now - stageStart[e.stage]);
          if (e.stage === "review") agentVerdict = e.detail?.replace("Agent verdict: ", "") ?? null;
        }
        if (e.type === "tool") tools.push(e.name);
        if (e.type === "error") error = e.message;
      });
      const totalMs = Math.round(performance.now() - t0);

      const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
      const checks = (row.checks ?? []) as CheckResult[];
      const ruleScore = Math.min(
        100,
        checks.reduce((s, c) => s + c.weight, 0),
      );
      const rulesOnly = decide(checks, ruleScore, null);
      const truth = printed(full);
      const same = (a: string | null, b: string | null) => normalizeId(a) === normalizeId(b);
      const extraction = {
        invoiceNumber: same(row.invoiceNumber, truth.invoiceNumber),
        taxId: same(row.vendorTaxId, truth.taxId),
        poNumber: same(row.poNumber, truth.poNumber),
        total: row.total != null && truth.total != null && Math.abs(row.total - truth.total) < 0.01,
        bankAccount: same(row.bankAccount, truth.bankAccount),
        lineCount: (row.lineItems?.length ?? 0) === truth.lineCount,
      };

      const r = {
        trial,
        file,
        status: row.status,
        riskScore: row.riskScore,
        ruleScore,
        rulesOnlyStatus: rulesOnly.status,
        agentVerdict,
        failed: checks.filter((c) => c.status === "fail").map((c) => c.id),
        warned: checks.filter((c) => c.status === "warn").map((c) => c.id),
        tools,
        stageMs,
        totalMs,
        extraction,
        error,
      };
      results.push(r);
      console.log(
        `  ${file.padEnd(46)} ${String(row.status).padEnd(9)} risk ${String(row.riskScore).padStart(3)}  rules ${rulesOnly.status.padEnd(9)} agent ${String(agentVerdict).padEnd(11)} ${totalMs} ms`,
      );
    }
  }

  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} results to ${out}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
