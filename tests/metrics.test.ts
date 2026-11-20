import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { parseFilters, type Filters } from "@/lib/metrics/filters";
import { byPeriod, customerTable, flatLines, grid, missingConversions, skuTable, totals, totalsWithChange } from "@/lib/metrics/queries";
import { headline } from "@/lib/metrics/dashboard";
import { parseItemName } from "@/lib/items";

// A small fixed data set in the test database, built to exercise every rule
// in SPEC.md's Calculations section.

const f = (p: Record<string, string> = {}): Filters => parseFilters({ from: "2026-01-01", to: "2026-12-31", ...p }, "2026-11-19");

const ITEMS: [string, string][] = [
  ["i1", "Wound Care:REMSF99B"],
  ["i2", "Amazon:REMSF99B - AMZ"],
  ["i3", "Skin Care:SCAF1003"],
  ["i4", "Amazon:SCAF1003-3PK-AMZ"],
  ["i5", "Wound Care:NOCONV"],
  ["i9", "Freight:Shipping"],
];
const CONVERSIONS: [string, number][] = [
  ["REMSF99B", 25],
  ["REMSF99B - AMZ", 25],
  ["SCAF1003", 24],
  ["SCAF1003-3PK-AMZ", 3],
];

// [docType, id, date, customer, lines: [item, qty, amount]], deleted?
const DOCS: [string, string, string, string, [string, number, number][], boolean?][] = [
  ["invoice", "a", "2026-01-10", "c1", [["i1", 10, 1610], ["i9", 1, 100]]],
  ["invoice", "b", "2026-01-20", "c2", [["i1", 4, 644], ["i3", 2, 144]]],
  ["invoice", "c", "2026-02-05", "c1", [["i2", 6, 1050], ["i4", 30, 659.7], ["i3", 1, 72]]],
  ["invoice", "d", "2026-03-01", "c2", [["i5", 5, 50], ["i1", 2, 0]]], // a $0 sample line
  ["credit_memo", "m", "2026-02-10", "c1", [["i1", 2, 322]]],
  ["invoice", "x", "2026-03-15", "c1", [["i1", 999, 99999]], true], // deleted
  ["invoice", "e", "2026-04-01", "c2", [["i5", 3, 30]]],
  ["credit_memo", "n", "2026-04-01", "c2", [["i5", 3, 30]]], // returns all of e
  ["invoice", "o", "2025-12-31", "c1", [["i1", 50, 8050]]], // outside the range
  ["invoice", "p", "2025-01-15", "c1", [["i1", 8, 1288]]], // prior year, same period
];

beforeAll(async () => {
  await prisma.$executeRaw`TRUNCATE invoice_lines, invoices, items, customers, sku_conversions RESTART IDENTITY CASCADE`;
  await prisma.customer.createMany({ data: [{ qboId: "c1", displayName: "Lakeland Supplychain RDC" }, { qboId: "c2", displayName: "General Hospital" }] });
  await prisma.item.createMany({
    data: ITEMS.map(([qboId, fullName]) => {
      const p = parseItemName(fullName);
      return { qboId, fullName, sku: p.sku, category: p.category, baseSku: p.baseSku, isPackVariant: p.isPackVariant, isProduct: p.isProduct };
    }),
  });
  await prisma.skuConversion.createMany({ data: CONVERSIONS.map(([sku, eachesPerUnit]) => ({ sku, eachesPerUnit, updatedBy: "test" })) });
  for (const [docType, id, date, customer, lines, deleted] of DOCS) {
    await prisma.invoice.create({
      data: {
        docType: docType as "invoice" | "credit_memo",
        qboId: id,
        docNumber: id.toUpperCase(),
        txnDate: new Date(`${date}T00:00:00Z`),
        customerQboId: customer,
        totalAmt: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(0),
        lastUpdatedQbo: new Date(),
        deleted: deleted ?? false,
        lines: {
          create: lines.map(([item, qty, amount], i) => ({
            lineNum: i + 1,
            itemQboId: item,
            qty: new Prisma.Decimal(qty),
            unitPrice: new Prisma.Decimal(qty ? amount / qty : 0),
            amount: new Prisma.Decimal(amount.toFixed(2)),
            description: `desc ${item}`,
          })),
        },
      },
    });
  }
});

afterAll(async () => {
  await prisma.$executeRaw`TRUNCATE invoice_lines, invoices, items, customers, sku_conversions RESTART IDENTITY CASCADE`;
  await prisma.$disconnect();
});

// In-range, non-deleted lines (credit memo negative):
//   a: i1 10/1610, i9 1/100 | b: i1 4/644, i3 2/144 | c: i2 6/1050, i4 30/659.7, i3 1/72
//   d: i5 5/50, i1 2/0 | m: i1 -2/-322 | e: i5 3/30, n: i5 -3/-30 (net 0)
const SALES = 1610 + 100 + 644 + 144 + 1050 + 659.7 + 72 + 50 + 0 - 322;

describe("totals", () => {
  it("sums every line in range, nets credit memos, skips deleted and out-of-range invoices", async () => {
    const t = await totals(f());
    expect(t.sales).toBeCloseTo(SALES, 2);
    expect(t.units).toBe(10 + 1 + 4 + 2 + 6 + 30 + 1 + 5 + 2 - 2);
    expect(t.invoices).toBe(5); // a b c d e; credit memos are not invoices
    expect(t.customers).toBe(2);
  });

  it("counts eaches with each SKU's own conversion, 0 for a SKU with none", async () => {
    // i1 (10+4+2-2)×25, i2 6×25, i3 3×24, i4 30×3, i5 none, i9 none
    expect((await totals(f())).eaches).toBe(14 * 25 + 6 * 25 + 3 * 24 + 30 * 3);
  });

  it("compares with the same dates a year earlier", async () => {
    const t = await totalsWithChange(f({ to: "2026-11-19" }));
    expect(t.prior.sales).toBe(1288);
    expect(t.change.sales).toBeCloseTo((SALES - 1288) / 1288, 6);
    expect(t.change.customers).toBe((2 - 1) / 1);
  });

  it("returns null change when last year had nothing", async () => {
    const t = await totalsWithChange(f({ from: "2026-02-01", to: "2026-02-28" }));
    expect(t.prior.sales).toBe(0);
    expect(t.change.sales).toBeNull();
  });

  it("applies both the customer and SKU filters", async () => {
    const t = await totals(f({ customer: "c1", sku: "REMSF99B" }));
    // a: i1 10/1610, c: i2 6/1050 (grouped under REMSF99B), m: -2/-322
    expect([t.units, t.sales, t.invoices]).toEqual([14, 2338, 2]);
  });

  it("drops $0 lines when asked", async () => {
    expect((await totals(f({ zero: "exclude" }))).units).toBe((await totals(f())).units - 2);
  });
});

describe("over time", () => {
  it("groups by invoice calendar month and fills empty months with zeros", async () => {
    const m = await byPeriod(f(), "month");
    expect(m.map((r) => r.period)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`));
    expect(m.slice(4).every((r) => r.sales === 0 && r.units === 0)).toBe(true);
    expect(m[0].sales).toBe(1610 + 100 + 644 + 144);
    expect(m[1].sales).toBeCloseTo(1050 + 659.7 + 72 - 322, 2);
  });

  it("groups by weeks starting Monday, filling empty weeks", async () => {
    const w = await byPeriod(f({ from: "2026-01-01", to: "2026-01-31" }), "week");
    // Jan 1, 2026 is a Thursday, so the first week starts Monday Dec 29.
    expect(w.map((r) => r.period)).toEqual(["2025-12-29", "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
    // Invoice a (Sat Jan 10) is in the week of Jan 5; invoice b (Tue Jan 20) in the week of Jan 19.
    expect(w.map((r) => r.sales)).toEqual([0, 1610 + 100, 0, 644 + 144, 0]);
  });

  it("counts only dates inside the range in a partial first week", async () => {
    // Invoice o (Wed Dec 31, 2025, $8,050) shares the week of Dec 29 with Jan 1 but is outside the range.
    const w = await byPeriod(f({ from: "2026-01-01", to: "2026-01-31" }), "week");
    expect(w[0]).toEqual({ period: "2025-12-29", sales: 0, units: 0, eaches: 0 });
    const wider = await byPeriod(f({ from: "2025-12-31", to: "2026-01-31" }), "week");
    expect(wider[0].sales).toBe(8050);
  });

  it("puts a Sunday in the week that started the Monday before", async () => {
    // Invoice d is dated Sun Mar 1, 2026.
    const w = await byPeriod(f({ from: "2026-02-23", to: "2026-03-08" }), "week");
    expect(w.map((r) => [r.period, r.sales])).toEqual([["2026-02-23", 50], ["2026-03-02", 0]]);
  });

  it("follows the interval in the filters by default", async () => {
    expect((await byPeriod(f({ interval: "week", from: "2026-01-05", to: "2026-01-11" })))[0].period).toBe("2026-01-05");
    expect((await byPeriod(f({ from: "2026-01-05", to: "2026-01-11" })))[0].period).toBe("2026-01-01");
  });
});

describe("SKU table", () => {
  it("shows product lines only, groups Amazon and pack variants under the base SKU", async () => {
    const t = await skuTable(f());
    const by = Object.fromEntries(t.rows.map((r) => [r.sku, r]));
    expect(Object.keys(by).sort()).toEqual(["NOCONV", "REMSF99B", "SCAF1003"]);
    expect(by.REMSF99B).toMatchObject({ units: 20, sales: 1610 + 644 + 1050 + 0 - 322, eaches: 20 * 25, eachesPerUnit: 25, mixesPacks: false });
    // SCAF1003: cases (24 each) and a 3-pack (3 each) mixed together
    expect(by.SCAF1003).toMatchObject({ units: 33, eachesPerUnit: null, mixedConversion: true, mixesPacks: true });
    expect(by.NOCONV).toMatchObject({ eaches: 0, eachesPerUnit: null, missingConversion: true });
  });

  it("computes % of product dollars and average price", async () => {
    const t = await skuTable(f());
    expect(t.productSales).toBeCloseTo(SALES - 100, 2);
    expect(t.nonProductSales).toBe(100);
    expect(t.rows.reduce((s, r) => s + r.pctOfSales, 0)).toBeCloseTo(100, 6);
    const remsf = t.rows.find((r) => r.sku === "REMSF99B")!;
    expect(remsf.avgPrice).toBeCloseTo(remsf.sales / 20, 6);
  });

  it("counts a $0 sample line in units but not dollars, and drops it with exclude-$0", async () => {
    const all = await skuTable(f({ from: "2026-03-01", to: "2026-03-01" }));
    expect(all.rows.find((r) => r.sku === "REMSF99B")).toMatchObject({ units: 2, sales: 0, avgPrice: 0 });
    const excl = await skuTable(f({ from: "2026-03-01", to: "2026-03-01", zero: "exclude" }));
    expect(excl.rows.find((r) => r.sku === "REMSF99B")).toBeUndefined();
  });

  it("leaves average price blank when units net to 0", async () => {
    // Invoice e sells 3 NOCONV on Apr 1; credit memo n returns all 3 the same day.
    const t = await skuTable(f({ from: "2026-04-01", to: "2026-04-01" }));
    expect(t.rows.find((r) => r.sku === "NOCONV")).toMatchObject({ units: 0, sales: 0, avgPrice: null });
  });

  it("shows Amazon variants separately when asked", async () => {
    const skus = (await skuTable(f({ amazon: "separate" }))).rows.map((r) => r.sku).sort();
    expect(skus).toEqual(["NOCONV", "REMSF99B", "REMSF99B - AMZ", "SCAF1003", "SCAF1003-3PK-AMZ"]);
  });

  it("is narrowed by a customer filter but not by a SKU filter", async () => {
    expect((await skuTable(f({ customer: "c2" }))).rows.map((r) => r.sku).sort()).toEqual(["NOCONV", "REMSF99B", "SCAF1003"]);
    expect((await skuTable(f({ customer: "c2" }))).rows.find((r) => r.sku === "REMSF99B")!.units).toBe(6);
    expect((await skuTable(f({ sku: "SCAF1003" }))).rows).toHaveLength(3);
  });
});

describe("customer table", () => {
  it("includes every line, counts invoices and distinct product SKUs", async () => {
    const rows = await customerTable(f());
    const c1 = rows.find((r) => r.customerId === "c1")!;
    expect(c1).toMatchObject({ customer: "Lakeland Supplychain RDC", invoices: 2, skusBought: 2 });
    expect(c1.sales).toBeCloseTo(1610 + 100 + 1050 + 659.7 + 72 - 322, 2);
    expect(rows.reduce((s, r) => s + r.pctOfSales, 0)).toBeCloseTo(100, 6);
  });

  it("is narrowed by a SKU filter but not by a customer filter", async () => {
    const bySku = await customerTable(f({ sku: "SCAF1003" }));
    expect(bySku.map((r) => [r.customerId, r.units]).sort()).toEqual([["c1", 31], ["c2", 2]]);
    expect(await customerTable(f({ customer: "c1" }))).toHaveLength(2);
  });
});

describe("SKU × customer grid", () => {
  it("puts customers in rows and the top SKUs in columns, in the chosen measure", async () => {
    const g = await grid(f({ measure: "units" }));
    expect(g.skus).toEqual(["SCAF1003", "REMSF99B", "NOCONV"]);
    const c1 = g.rows.find((r) => r.customerId === "c1")!;
    expect(c1.cells).toEqual({ REMSF99B: 14, SCAF1003: 31 });
    expect(g.max).toBe(31);
  });

  it("limits columns to the top N and applies both filters", async () => {
    expect((await grid(f(), 1)).skus).toEqual(["REMSF99B"]);
    const g = await grid(f({ customer: "c2", sku: "REMSF99B" }));
    expect(g.skus).toEqual(["REMSF99B"]);
    expect(g.rows.map((r) => r.customerId)).toEqual(["c2"]);
  });
});

describe("missing conversions and export", () => {
  it("names product SKUs sold without a conversion", async () => {
    expect(await missingConversions(f())).toEqual([{ sku: "NOCONV", units: 5 }]);
  });

  it("exports the flat lines behind the totals, with exact decimals", async () => {
    const lines = await flatLines(f());
    const t = await totals(f());
    const sum = lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100;
    expect(sum).toBeCloseTo(t.sales, 2);
    expect(lines.find((l) => l.docType === "credit_memo")).toMatchObject({ qty: "-2.00", amount: "-322.00", eaches: "-50.00" });
    expect(lines.find((l) => l.docNumber === "X")).toBeUndefined();
  });
});

describe("headline", () => {
  it("names the top SKU and customer", async () => {
    const [skus, customers] = await Promise.all([skuTable(f()), customerTable(f())]);
    const top = [...skus.rows].sort((a, b) => b.sales - a.sales)[0];
    expect(headline(f(), skus.rows, customers, null)).toBe(
      `REMSF99B leads with ${top.pctOfSales.toFixed(1)}% of product dollars; Lakeland Supplychain RDC is the largest customer at ${customers.find((c) => c.customerId === "c1")!.pctOfSales.toFixed(1)}%.`,
    );
  });

  it("speaks to the customer when one is selected, and handles no data", async () => {
    const skus = await skuTable(f({ customer: "c2" }));
    expect(headline(f({ customer: "c2" }), skus.rows, [], "General Hospital")).toMatch(/^For General Hospital, REMSF99B leads with/);
    expect(headline(f(), [], [], null)).toBe("No sales in this date range.");
  });
});
