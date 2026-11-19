import { describe, expect, it } from "vitest";
import { csvCell, decimalCell, toCsv } from "@/lib/csv";

describe("CSV", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('WATERPROOF, ISLAND, DRESSING 2"x2"')).toBe('"WATERPROOF, ISLAND, DRESSING 2""x2"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("defuses text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-AMZ")).toBe("'-AMZ");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("writes numbers, including negatives, as numbers", () => {
    expect(csvCell(-322)).toBe("-322");
    expect(csvCell(3569612.5)).toBe("3569612.5");
    expect(decimalCell("-322.00")).toBe("-322.00");
    expect(() => decimalCell("=1+1")).toThrow();
  });

  it("writes blanks for null and starts with a BOM", () => {
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["1", ""]])).toBe("﻿a,b\r\n1,\r\n");
  });
});
