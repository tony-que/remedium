import { parse } from "csv-parse/sync";

// Reads the owner's eaches-conversion table, e.g. sku_eaches_conversion.csv:
//   sku,description,eaches_per_unit,note

export interface ConversionRow {
  sku: string;
  description: string | null;
  eachesPerUnit: number;
  note: string | null;
}

const REQUIRED_COLUMNS = ["sku", "eaches_per_unit"] as const;

/** Parses the CSV text and validates every row. Throws on the first bad row. */
export function parseConversionsCsv(text: string): ConversionRow[] {
  const records: Record<string, string>[] = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (records.length > 0) {
    for (const col of REQUIRED_COLUMNS) {
      if (!(col in records[0])) throw new Error(`Conversion CSV is missing the "${col}" column`);
    }
  }

  const seen = new Set<string>();
  return records.map((r, i) => {
    const line = i + 2; // 1-based, after the header row
    const sku = r.sku;
    if (!sku) throw new Error(`Conversion CSV line ${line}: sku is empty`);
    if (seen.has(sku)) throw new Error(`Conversion CSV line ${line}: duplicate sku "${sku}"`);
    seen.add(sku);

    const raw = r.eaches_per_unit;
    if (!/^\d+$/.test(raw ?? "")) {
      throw new Error(`Conversion CSV line ${line}: eaches_per_unit "${raw}" for ${sku} is not a whole number`);
    }
    return {
      sku,
      description: r.description || null,
      eachesPerUnit: Number(raw),
      note: r.note || null,
    };
  });
}
