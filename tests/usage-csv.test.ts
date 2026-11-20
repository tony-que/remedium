import { describe, expect, it } from "vitest";
import { parseUsageCsv } from "@/lib/usage-csv";

describe("parseUsageCsv", () => {
  it("reads sku and monthly usage, ignoring other columns", () => {
    expect(parseUsageCsv("sku,description,monthly_usage\nREMSF99B,Foam,2200\nSCAF1003,Powder,12.5\n")).toEqual([
      { sku: "REMSF99B", monthlyUnits: 2200 },
      { sku: "SCAF1003", monthlyUnits: 12.5 },
    ]);
  });

  it("accepts other column names and thousands separators", () => {
    expect(parseUsageCsv('SKU,Monthly Units\nREMSF99B,"2,200"\n')).toEqual([{ sku: "REMSF99B", monthlyUnits: 2200 }]);
  });

  it.each([
    ["sku,usage\n", /no rows/],
    ["item,monthly_usage\nA,1\n", /"sku" column/],
    ["sku,qty\nA,1\n", /monthly_usage/],
    ["sku,monthly_usage\nA,abc\n", /line 2.*not a number/],
    ["sku,monthly_usage\nA,1\na,2\n", /line 3: duplicate/],
  ])("rejects %j", (csv, message) => {
    expect(() => parseUsageCsv(csv)).toThrow(message);
  });
});
