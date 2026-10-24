const COMPANY_SUFFIXES = new Set([
  "the",
  "pvt",
  "private",
  "ltd",
  "limited",
  "llp",
  "llc",
  "inc",
  "incorporated",
  "co",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "plc",
]);

/** Uppercase alphanumerics only — for tax IDs, account numbers, invoice numbers. */
export function normalizeId(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Lowercase company name without punctuation or legal suffixes. */
export function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.has(w))
    .join(" ");
}

function bigrams(s: string) {
  const compact = s.replace(/\s+/g, "");
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

function dice(x: string, y: string) {
  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
  const size = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  const total = size(gx) + size(gy);
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Sørensen–Dice similarity of two company names, 0..1. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return dice(x, y);
}

const FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "for",
  "with",
  "pack",
  "set",
  "box",
  "nos",
  "pcs",
  "units",
]);

function productTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/**
 * How well an invoice line description refers to an inventory item, 0..1. Invoices tend to
 * pad item names with pack sizes and notes, so coverage of the item's own words counts as much
 * as overall character similarity. An exact SKU mention is a certain match.
 */
export function productSimilarity(description: string, item: { name: string; sku: string }) {
  if (normalizeId(description).includes(normalizeId(item.sku))) return 1;
  const itemWords = productTokens(item.name);
  const lineWords = new Set(productTokens(description));
  if (itemWords.length === 0 || lineWords.size === 0) return 0;
  const coverage = itemWords.filter((w) => lineWords.has(w)).length / itemWords.length;
  return 0.5 * coverage + 0.5 * dice(itemWords.join(""), [...lineWords].join(""));
}

export function maskAccount(value: string | null | undefined) {
  const id = normalizeId(value);
  if (!id) return "—";
  return id.length <= 4 ? id : `••••${id.slice(-4)}`;
}
