import { parse } from "csv-parse/sync";

// Reads the owner's monthly-usage table: one row per SKU with its expected
// monthly usage in QuickBooks units (cases), for example
//   sku,monthly_usage
//   REMSF99B,2200
// "monthly_units" and "usage" are accepted as the column name too. Extra
// columns (description, notes) are ignored.

export interface UsageRow {
  sku: string;
  monthlyUnits: number;
}

const USAGE_COLUMNS = ["monthly_usage", "monthly_units", "usage"] as const;

export function parseUsageCsv(text: string): UsageRow[] {
  const records: Record<string, string>[] = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (records.length === 0) throw new Error("The usage file has no rows.");
  if (!("sku" in records[0])) throw new Error('The usage file is missing the "sku" column.');
  const col = USAGE_COLUMNS.find((c) => c in records[0]);
  if (!col) throw new Error('The usage file is missing a "monthly_usage" column.');

  const seen = new Set<string>();
  return records.map((r, i) => {
    const line = i + 2;
    const sku = r.sku;
    if (!sku) throw new Error(`Usage file line ${line}: sku is empty.`);
    if (seen.has(sku.toUpperCase())) throw new Error(`Usage file line ${line}: duplicate sku "${sku}".`);
    seen.add(sku.toUpperCase());
    const raw = (r[col] ?? "").replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      throw new Error(`Usage file line ${line}: monthly usage "${r[col]}" for ${sku} is not a number (use cases per month, up to 2 decimals).`);
    }
    return { sku, monthlyUnits: Number(raw) };
  });
}
