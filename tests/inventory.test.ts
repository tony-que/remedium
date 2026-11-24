import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { saveConnection } from "@/lib/qbo/connection";
import { runInventorySync } from "@/lib/inventory/sync";
import { inventoryRows, openPurchaseOrders } from "@/lib/inventory/queries";
import { replaceUsage } from "@/lib/usage";
import { reorderMonths } from "@/lib/inventory/plan";
import { FakeQbo } from "./helpers/fake-qbo";

// Inventory sync from a fake QuickBooks (items, open POs and bills), then the dashboard rows built from
// stock, cost, conversions, monthly usage and recent sales.

const TODAY = "2026-11-20"; // last 3 full months: Aug 1 – Oct 31
const qbo = new FakeQbo();

const TABLES = Prisma.sql`TRUNCATE inventory_levels, open_po_lines, inventory_sync_runs, sku_usage, invoice_lines, invoices, items, customers, sku_conversions, qbo_connection, audit_log RESTART IDENTITY CASCADE`;

function sync() {
  return runInventorySync({ trigger: "test", fetchImpl: qbo.fetch, sleep: async () => {}, now: () => qbo.now(), pageSize: 2 });
}

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
  qbo.items.set("i1", { Id: "i1", FullyQualifiedName: "Wound Care:REMSF99B", Type: "Inventory", TrackQtyOnHand: true, Active: true, QtyOnHand: 1050, QtyOnSalesOrder: 50, PurchaseCost: 64.5, Description: "Foam 9x9" });
  qbo.items.set("i2", { Id: "i2", FullyQualifiedName: "Skin Care:SCAF1003", Type: "Inventory", TrackQtyOnHand: true, Active: true, QtyOnHand: 40 });
  qbo.items.set("i3", { Id: "i3", FullyQualifiedName: "Freight:Shipping", Type: "Service", Active: true });
  // REMSF99B: 250 ordered, 50 billed → 200 to receive. A closed PO and one for a service item don't count.
  qbo.purchaseOrders.set("p1", {
    Id: "p1",
    DocNumber: "1042",
    TxnDate: "2026-10-01",
    DueDate: "2026-12-30",
    POStatus: "Open",
    VendorRef: { value: "v1", name: "Acme Mfg" },
    Line: [
      { Id: "1", DetailType: "ItemBasedExpenseLineDetail", Amount: 15000, ItemBasedExpenseLineDetail: { ItemRef: { value: "i1" }, Qty: 250, UnitPrice: 60 } },
      { Id: "2", DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: { value: "i3" }, Qty: 1 } },
    ],
  });
  qbo.purchaseOrders.set("p2", {
    Id: "p2",
    TxnDate: "2026-09-01",
    POStatus: "Closed",
    Line: [{ Id: "1", DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: { value: "i2" }, Qty: 500 } }],
  });
  qbo.bills.set("b1", {
    Id: "b1",
    TxnDate: "2026-10-20",
    Line: [
      {
        Id: "1",
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: { ItemRef: { value: "i1" }, Qty: 50 },
        LinkedTxn: [{ TxnId: "p1", TxnType: "PurchaseOrder", TxnLineId: "1" }],
      },
    ],
  });
  qbo.items.set("i4", { Id: "i4", FullyQualifiedName: "Wound Care:REMOLD", Type: "Inventory", TrackQtyOnHand: true, Active: true, QtyOnHand: 1 });
  await saveConnection(
    "admin@example.com",
    "9341458739894245",
    "sandbox",
    {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessTokenExpiresAt: new Date(qbo.now().getTime() + 3600_000),
      refreshTokenExpiresAt: new Date(qbo.now().getTime() + 100 * 86_400_000),
    },
    "Fake Co",
  );
});

afterAll(async () => {
  await prisma.$executeRaw(TABLES);
  await prisma.$disconnect();
});

describe("inventory", () => {
  it("syncs items that track quantity from QuickBooks, refreshing item cost, and replaces the table each time", async () => {
    expect(await sync()).toMatchObject({ status: "succeeded", skus: 3 });
    expect((await prisma.item.findUniqueOrThrow({ where: { qboId: "i1" } })).purchaseCost?.toString()).toBe("64.5");
    const foam = await prisma.inventoryLevel.findUniqueOrThrow({ where: { sku: "REMSF99B" } });
    expect([foam.qtyAvailable.toString(), foam.qtyReserved.toString(), foam.qtyIncoming.toString(), foam.name]).toEqual(["1000", "50", "200", "Foam 9x9"]);

    expect(await openPurchaseOrders()).toEqual([
      { sku: "REMSF99B", line: "wound", docNumber: "1042", vendor: "Acme Mfg", txnDate: "2026-10-01", expectedDate: "2026-12-30", ordered: 250, remaining: 200, amount: 15000, openAmount: 12000 },
    ]);
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { sku: "SCAF1003" } })).qtyIncoming.toString()).toBe("0");

    qbo.items.set("i4", { ...qbo.items.get("i4")!, Active: false });
    expect(await sync()).toMatchObject({ status: "succeeded", skus: 2 });
    expect((await prisma.inventoryLevel.findMany({ orderBy: { sku: "asc" } })).map((l) => l.sku)).toEqual(["REMSF99B", "SCAF1003"]);
  });

  it("keeps the last stock when QuickBooks has no stock-tracked items", async () => {
    const saved = new Map(qbo.items);
    qbo.items.clear();
    qbo.items.set("i3", saved.get("i3")!);
    expect(await sync()).toMatchObject({ status: "failed" });
    expect(await prisma.inventoryLevel.count()).toBe(2);
    qbo.items.clear();
    for (const [k, v] of saved) qbo.items.set(k, v);
  });

  it("builds months of supply, reorder advice and value", async () => {
    await prisma.skuConversion.create({ data: { sku: "REMSF99B", eachesPerUnit: 25, updatedBy: "test" } });
    // REMSF99B: 900 cases over Aug–Oct (300/month); a July sale and a November sale don't count.
    await invoice("a", "2026-08-15", "i1", 300);
    await invoice("b", "2026-09-15", "i1", 300);
    await invoice("c", "2026-10-31", "i1", 300);
    await invoice("d", "2026-07-31", "i1", 5000);
    await invoice("e", "2026-11-01", "i1", 5000);

    const rows = await inventoryRows(TODAY);
    const foam = rows.find((r) => r.sku === "REMSF99B")!;
    expect(foam).toMatchObject({ line: "wound", available: 1000, reserved: 50, incoming: 200, monthlyUsage: 300, usageSource: "sales", eachesPerUnit: 25, unitCost: 64.5 });
    expect(foam.monthsOnHand).toBeCloseTo(1000 / 300, 6);
    expect(foam.leadTimeDays).toBe(60); // ends in B
    expect(foam.status).toBe("order_now"); // 1,200 with POs is under ~4.97 × 300
    expect(foam.suggestedOrder).toBe(Math.ceil(reorderMonths(60) * 300 - 1200));
    expect(foam.value).toBeCloseTo(1050 * 64.5, 6);

    expect(rows.find((r) => r.sku === "SCAF1003")).toMatchObject({ line: "skin", status: "no_usage", value: null });
  });

  it("uses the owner's monthly usage when it is higher", async () => {
    await replaceUsage("test", [
      { sku: "REMSF99B", monthlyUnits: 100 },
      { sku: "SCAF1003", monthlyUnits: 20 },
    ]);
    const rows = await inventoryRows(TODAY);
    expect(rows.find((r) => r.sku === "REMSF99B")).toMatchObject({ monthlyUsage: 300, usageSource: "sales" });
    expect(rows.find((r) => r.sku === "SCAF1003")).toMatchObject({ monthlyUsage: 20, usageSource: "provided", monthsOnHand: 2, status: "below_floor" });
  });
});
