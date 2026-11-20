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
      interval: "month",
      line: null,
    });
  });

  it("reads the week interval, and ignores anything else", () => {
    expect(parseFilters({ interval: "week" }, TODAY).interval).toBe("week");
    expect(parseFilters({ interval: "day" }, TODAY).interval).toBe("month");
    expect(filtersToQuery(parseFilters({ interval: "week" }, TODAY))).toBe("from=2026-01-01&to=2026-11-19&interval=week");
  });

  it("reads every filter and round-trips through the query string", () => {
    const f = parseFilters(
      { from: "2025-03-01", to: "2025-03-31", measure: "eaches", customer: "58", sku: "REMSF99B - AMZ", zero: "exclude", amazon: "separate", interval: "week", line: "skin" },
      TODAY,
    );
    expect(f).toEqual({ from: "2025-03-01", to: "2025-03-31", measure: "eaches", customer: "58", sku: "REMSF99B - AMZ", excludeZero: true, amazonSeparate: true, interval: "week", line: "skin" });
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

  it("reads the product line, and ignores unknown lines", () => {
    expect(parseFilters({ line: "wound" }, TODAY).line).toBe("wound");
    expect(parseFilters({ line: "support" }, TODAY).line).toBe("support");
    expect(parseFilters({ line: "pharmacy" }, TODAY).line).toBeNull();
    expect(filtersToQuery(parseFilters({ line: "wound" }, TODAY))).toBe("from=2026-01-01&to=2026-11-19&line=wound");
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
