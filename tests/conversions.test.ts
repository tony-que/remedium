import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConversionsCsv } from "@/lib/conversions";

const csv = readFileSync(path.join(__dirname, "..", "sku_eaches_conversion.csv"), "utf8");

describe("sku_eaches_conversion.csv", () => {
  const rows = parseConversionsCsv(csv);
  const bySku = new Map(rows.map((r) => [r.sku, r]));

  it("has the 54 SKUs from the owner's 2026-11-19 table", () => {
    expect(rows).toHaveLength(54);
  });

  it("parses known values, including SKUs with spaces", () => {
    expect(bySku.get("REMSF99B")?.eachesPerUnit).toBe(25);
    expect(bySku.get("REMSF99B - AMZ")?.eachesPerUnit).toBe(25);
    expect(bySku.get("SCAF1003-3PK-AMZ")?.eachesPerUnit).toBe(3);
    expect(bySku.get("HOMECARE MATTRESS")?.eachesPerUnit).toBe(1);
    expect(bySku.get("REMWBG44")?.eachesPerUnit).toBe(200);
  });

  it("keeps quoted descriptions with commas and doubled quotes intact", () => {
    expect(bySku.get("REMWBG22")?.description).toBe('WATERPROOF, NONWOVEN, ISLAND, DRESSING 2"x2", 10PK/BX, 20BX/CS');
  });
});

describe("parseConversionsCsv", () => {
  it("rejects a non-integer conversion", () => {
    expect(() => parseConversionsCsv("sku,eaches_per_unit\nA,2.5\n")).toThrow(/line 2.*not a whole number/);
  });

  it("rejects duplicate SKUs", () => {
    expect(() => parseConversionsCsv("sku,eaches_per_unit\nA,1\nA,2\n")).toThrow(/duplicate sku "A"/);
  });

  it("rejects a file without the eaches_per_unit column", () => {
    expect(() => parseConversionsCsv("sku,qty\nA,1\n")).toThrow(/missing the "eaches_per_unit" column/);
  });
});
