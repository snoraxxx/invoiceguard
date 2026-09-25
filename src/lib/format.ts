import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export function formatMoney(amount: number | null | undefined, currency?: string | null, opts?: { compact?: boolean }) {
  if (amount == null) return "—";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "INR";
  try {
    return new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: code,
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? parseISO(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : format(d, "d MMM yyyy");
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? parseISO(value) : value;
  return format(d, "d MMM yyyy, HH:mm");
}

export function timeAgo(value: Date | string) {
  const d = typeof value === "string" ? parseISO(value) : value;
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
