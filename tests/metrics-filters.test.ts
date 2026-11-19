import { describe, expect, it } from "vitest";
import { activePreset, filtersToQuery, parseFilters, presetRange, priorYear, todayCentral, yearEarlier } from "@/lib/metrics/filters";

const TODAY = "2026-11-19";

describe("parseFilters", () => {
  it("defaults to year to date in Sales $", () => {
    expect(parseFilters({}, TODAY)).toEqual({
      from: "2026-01-01",
      to: "2026-11-19",
      measure: "sales",
      customer: null,
      sku: null,
      excludeZero: false,
      amazonSeparate: false,
    });
  });

  it("reads every filter and round-trips through the query string", () => {
    const f = parseFilters(
      { from: "2025-03-01", to: "2025-03-31", measure: "eaches", customer: "58", sku: "REMSF99B - AMZ", zero: "exclude", amazon: "separate" },
      TODAY,
    );
    expect(f).toEqual({ from: "2025-03-01", to: "2025-03-31", measure: "eaches", customer: "58", sku: "REMSF99B - AMZ", excludeZero: true, amazonSeparate: true });
    expect(parseFilters(new URLSearchParams(filtersToQuery(f)), TODAY)).toEqual(f);
  });

  it("leaves defaults out of the query string", () => {
    expect(filtersToQuery(parseFilters({}, TODAY))).toBe("from=2026-01-01&to=2026-11-19");
  });

  it.each([
    [{ from: "2026-02-30", to: "2026-03-01" }],
    [{ from: "2026-05-01", to: "2026-04-01" }],
    [{ from: "yesterday", to: "2026-04-01" }],
  ])("falls back to the default range for %o", (p) => {
    expect(parseFilters(p, TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY });
  });

  it("ignores unknown measures and odd customer ids", () => {
    expect(parseFilters({ measure: "margin", customer: "58; DROP TABLE" }, TODAY)).toMatchObject({ measure: "sales", customer: null });
  });
});

describe("date presets", () => {
  const cur = { from: "2026-01-01", to: TODAY };
  it("computes each preset", () => {
    expect(presetRange("ytd", cur, TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
    expect(presetRange("last90", cur, TODAY)).toEqual({ from: "2026-08-22", to: TODAY });
    expect(presetRange("lastYear", cur, TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(presetRange("samePeriodLastYear", cur, TODAY)).toEqual({ from: "2025-01-01", to: "2025-11-19" });
  });

  it("recognizes the active preset", () => {
    expect(activePreset(cur, TODAY)).toBe("ytd");
    expect(activePreset({ from: "2025-01-01", to: "2025-12-31" }, TODAY)).toBe("lastYear");
    expect(activePreset({ from: "2026-02-01", to: "2026-02-28" }, TODAY)).toBeNull();
  });

  it("moves Feb 29 to Feb 28 a year earlier", () => {
    expect(yearEarlier("2028-02-29")).toBe("2027-02-28");
    expect(yearEarlier("2026-03-01")).toBe("2025-03-01");
  });

  it("shifts both ends for the prior-year comparison", () => {
    expect(priorYear(parseFilters({}, TODAY))).toMatchObject({ from: "2025-01-01", to: "2025-11-19" });
  });

  it("uses the Central date, not UTC", () => {
    // 02:00 UTC on Nov 20 is still Nov 19 in Chicago.
    expect(todayCentral(new Date("2026-11-20T02:00:00Z"))).toBe("2026-11-19");
  });
});
