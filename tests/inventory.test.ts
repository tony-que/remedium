import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { parseItemName } from "@/lib/items";
import { runInventorySync } from "@/lib/inventory/sync";
import { inventoryRows } from "@/lib/inventory/queries";
import { replaceUsage } from "@/lib/usage";
import { REORDER_MONTHS } from "@/lib/inventory/plan";

// Inventory sync from a fake Orderwerks, then the dashboard rows built from
// stock, QuickBooks cost, conversions, monthly usage and recent sales.

const TODAY = "2026-11-20"; // last 3 full months: Aug 1 – Oct 31
const config = { apiKey: "k", apiSecret: "s", baseUrl: "https://ow.test", catalogGuids: [] as string[] };

let catalogItems: Record<string, unknown>[] = [];
const fetchImpl = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname === "/v1/catalogs") return new Response(JSON.stringify({ catalogs: [{ guid: "cat-1" }] }));
  if (url.pathname === "/v1/catalog/cat-1/catalog_items") {
    return new Response(JSON.stringify({ catalog_items: url.searchParams.get("offset") === "0" ? catalogItems : [], hasMoreItems: false }));
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const TABLES = Prisma.sql`TRUNCATE inventory_levels, inventory_sync_runs, sku_usage, invoice_lines, invoices, items, customers, sku_conversions RESTART IDENTITY CASCADE`;

async function invoice(id: string, date: string, item: string, qty: number) {
  await prisma.invoice.create({
    data: {
      docType: "invoice",
      qboId: id,
      docNumber: id,
      txnDate: new Date(`${date}T00:00:00Z`),
      customerQboId: "c1",
      totalAmt: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(0),
      lastUpdatedQbo: new Date(),
      lines: { create: [{ lineNum: 1, itemQboId: item, qty: new Prisma.Decimal(qty), unitPrice: new Prisma.Decimal(1), amount: new Prisma.Decimal(qty) }] },
    },
  });
}

beforeAll(async () => {
  await prisma.$executeRaw(TABLES);
  for (const [qboId, fullName, cost] of [
    ["i1", "Wound Care:REMSF99B", "64.5"],
    ["i2", "Skin Care:SCAF1003", null],
  ] as const) {
    const p = parseItemName(fullName);
    await prisma.item.create({
      data: { qboId, fullName, sku: p.sku, category: p.category, baseSku: p.baseSku, isPackVariant: p.isPackVariant, isProduct: p.isProduct, purchaseCost: cost },
    });
  }
  await prisma.skuConversion.create({ data: { sku: "REMSF99B", eachesPerUnit: 25, updatedBy: "test" } });
  // REMSF99B: 900 cases over Aug–Oct (300/month); a July sale and a November sale don't count.
  await invoice("a", "2026-08-15", "i1", 300);
  await invoice("b", "2026-09-15", "i1", 300);
  await invoice("c", "2026-10-31", "i1", 300);
  await invoice("d", "2026-07-31", "i1", 5000);
  await invoice("e", "2026-11-01", "i1", 5000);
});

afterAll(async () => {
  await prisma.$executeRaw(TABLES);
  await prisma.$disconnect();
});

describe("inventory", () => {
  it("syncs stock-tracked items from Orderwerks, replacing the table each time", async () => {
    catalogItems = [
      { guid: "g1", sku: "REMSF99B", name: "Foam 9x9", has_inventory: true, qty_on_hand: 1000, reserved_qty_on_hand: 50, qty_incoming: 200 },
      { guid: "g2", sku: "SCAF1003", has_inventory: true, qty_on_hand: 40 },
      { guid: "g3", sku: "OLDSKU", has_inventory: true, qty_on_hand: 1 },
    ];
    expect(await runInventorySync({ trigger: "test", config, fetchImpl })).toMatchObject({ status: "succeeded", skus: 3 });
    catalogItems = catalogItems.slice(0, 2);
    expect(await runInventorySync({ trigger: "test", config, fetchImpl })).toMatchObject({ status: "succeeded", skus: 2 });
    expect((await prisma.inventoryLevel.findMany({ orderBy: { sku: "asc" } })).map((l) => l.sku)).toEqual(["REMSF99B", "SCAF1003"]);
  });

  it("keeps the last stock when Orderwerks returns nothing", async () => {
    catalogItems = [];
    const r = await runInventorySync({ trigger: "test", config, fetchImpl });
    expect(r).toMatchObject({ status: "failed" });
    expect(await prisma.inventoryLevel.count()).toBe(2);
  });

  it("builds months of supply, reorder advice and value", async () => {
    const rows = await inventoryRows(TODAY, "cases");
    const foam = rows.find((r) => r.sku === "REMSF99B")!;
    expect(foam).toMatchObject({ line: "wound", available: 1000, reserved: 50, incoming: 200, monthlyUsage: 300, usageSource: "sales", eachesPerUnit: 25, unitCost: 64.5 });
    expect(foam.monthsOnHand).toBeCloseTo(1000 / 300, 6);
    expect(foam.status).toBe("order_now"); // 1,200 with POs is under ~5.96 × 300
    expect(foam.suggestedOrder).toBe(Math.ceil(REORDER_MONTHS * 300 - 1200));
    expect(foam.value).toBeCloseTo(1050 * 64.5, 6);

    const powder = rows.find((r) => r.sku === "SCAF1003")!;
    expect(powder).toMatchObject({ line: "skin", status: "no_usage", value: null });
  });

  it("uses the owner's monthly usage when it is higher", async () => {
    await replaceUsage("test", [
      { sku: "REMSF99B", monthlyUnits: 100 },
      { sku: "SCAF1003", monthlyUnits: 20 },
    ]);
    const rows = await inventoryRows(TODAY, "cases");
    expect(rows.find((r) => r.sku === "REMSF99B")).toMatchObject({ monthlyUsage: 300, usageSource: "sales" });
    expect(rows.find((r) => r.sku === "SCAF1003")).toMatchObject({ monthlyUsage: 20, usageSource: "provided", monthsOnHand: 2, status: "below_floor" });
  });

  it("converts eaches to cases when Orderwerks counts eaches", async () => {
    const rows = await inventoryRows(TODAY, "eaches");
    expect(rows.find((r) => r.sku === "REMSF99B")).toMatchObject({ available: 40, missingConversion: false });
    expect(rows.find((r) => r.sku === "SCAF1003")).toMatchObject({ available: 0, missingConversion: true });
  });
});
