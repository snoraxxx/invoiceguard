export type LineItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type CheckId =
  "document" | "vendor" | "tax_id" | "bank" | "duplicate" | "arithmetic" | "purchase_order" | "dates";

export type CheckResult = {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Risk points this check contributes to the rule score (0 when passing). */
  weight: number;
};

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
};

export type AgentStep = {
  kind: "tool" | "note";
  name: string;
  input?: unknown;
  output?: string;
  at: string;
};

/** Events streamed to the browser while an invoice is analyzed. */
export type AnalysisEvent =
  | { type: "created"; invoiceId: string }
  | { type: "stage"; stage: Stage; state: "running" | "done" | "skipped"; detail?: string }
  | { type: "check"; check: CheckResult }
  | { type: "tool"; name: string; summary: string }
  | {
      type: "result";
      invoiceId: string;
      status: "verified" | "flagged" | "rejected";
      riskScore: number;
      summary: string | null;
    }
  | { type: "error"; message: string; invoiceId?: string };

export type Stage = "upload" | "extract" | "checks" | "review" | "decision";
