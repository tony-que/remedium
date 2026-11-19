import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { parseItemName } from "@/lib/items";
import { inRollback } from "./helpers/rollback";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface Row {
  doc_type: "invoice" | "credit_memo";
  doc_number: string;
  sku: string;
  base_sku: string;
  category: string | null;
  is_product: boolean;
  is_pack_variant: boolean;
  qty: Prisma.Decimal;
  amount: Prisma.Decimal;
  eaches: Prisma.Decimal;
  eaches_per_unit: number | null;
  has_conversion: boolean;
  customer_name: string;
  month: Date;
}

async function item(tx: Tx, qboId: string, fullName: string) {
  const p = parseItemName(fullName);
  await tx.item.create({
    data: {
      qboId,
      fullName,
      sku: p.sku,
      category: p.category,
      baseSku: p.baseSku,
      isPackVariant: p.isPackVariant,
      isProduct: p.isProduct,
    },
  });
}

async function doc(
  tx: Tx,
  docType: "invoice" | "credit_memo",
  qboId: string,
  date: string,
  lines: { item: string | null; itemName?: string; qty: number; amount: number }[],
  opts: { deleted?: boolean; customer?: string } = {},
) {
  await tx.invoice.create({
    data: {
      docType,
      qboId,
      docNumber: qboId.toUpperCase(),
      txnDate: new Date(`${date}T00:00:00Z`),
      customerQboId: opts.customer ?? "t-cust",
      customerName: "Name From Invoice",
      totalAmt: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(0),
      lastUpdatedQbo: new Date(),
      deleted: opts.deleted ?? false,
      lines: {
        create: lines.map((l, i) => ({
          lineNum: i + 1,
          itemQboId: l.item,
          itemName: l.itemName ?? null,
          qty: new Prisma.Decimal(l.qty),
          unitPrice: new Prisma.Decimal(l.qty ? l.amount / l.qty : 0),
          amount: new Prisma.Decimal(l.amount.toFixed(2)),
        })),
      },
    },
  });
}

const rows = (tx: Tx, where: Prisma.Sql = Prisma.sql`TRUE`) =>
  tx.$queryRaw<Row[]>`SELECT * FROM sales_lines WHERE ${where} ORDER BY doc_number, line_id`;

describe("sales_lines view", () => {
  afterAll(() => prisma.$disconnect());

  it("returns invoice lines with item, customer and eaches", async () => {
    await inRollback(async (tx) => {
      await tx.customer.create({ data: { qboId: "t-cust", displayName: "Test Customer" } });
      await item(tx, "t-1", "Wound Care:Foam:TSTSKU1");
      await tx.skuConversion.create({ data: { sku: "TSTSKU1", eachesPerUnit: 25, updatedBy: "test" } });
      await doc(tx, "invoice", "t-inv-1", "2026-03-31", [{ item: "t-1", qty: 4, amount: 644 }]);

      const [r] = await rows(tx);
      expect(r.sku).toBe("TSTSKU1");
      expect(r.category).toBe("Wound Care › Foam");
      expect(r.customer_name).toBe("Test Customer");
      expect(r.qty.toString()).toBe("4");
      expect(r.amount.toString()).toBe("644");
      expect(r.eaches_per_unit).toBe(25);
      expect(r.eaches.toString()).toBe("100");
      expect(r.has_conversion).toBe(true);
      expect(r.month.toISOString().slice(0, 10)).toBe("2026-03-01");
    });
  });

  it("makes credit memo lines negative so sums net them out", async () => {
    await inRollback(async (tx) => {
      await item(tx, "t-1", "Wound Care:TSTSKU1");
      await tx.skuConversion.create({ data: { sku: "TSTSKU1", eachesPerUnit: 25, updatedBy: "test" } });
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [{ item: "t-1", qty: 10, amount: 1610 }]);
      await doc(tx, "credit_memo", "t-cm-1", "2026-03-05", [{ item: "t-1", qty: 2, amount: 322 }]);

      const cm = await rows(tx, Prisma.sql`doc_type = 'credit_memo'`);
      expect(cm[0].qty.toString()).toBe("-2");
      expect(cm[0].amount.toString()).toBe("-322");
      expect(cm[0].eaches.toString()).toBe("-50");

      const [sum] = await tx.$queryRaw<{ units: Prisma.Decimal; sales: Prisma.Decimal; eaches: Prisma.Decimal; invoices: bigint }[]>`
        SELECT sum(qty) units, sum(amount) sales, sum(eaches) eaches,
               count(DISTINCT invoice_qbo_id) FILTER (WHERE doc_type = 'invoice') invoices
        FROM sales_lines`;
      expect(sum.units.toString()).toBe("8");
      expect(sum.sales.toString()).toBe("1288");
      expect(sum.eaches.toString()).toBe("200");
      expect(sum.invoices).toBe(1n);
    });
  });

  it("leaves out deleted invoices", async () => {
    await inRollback(async (tx) => {
      await item(tx, "t-1", "Wound Care:TSTSKU1");
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [{ item: "t-1", qty: 1, amount: 100 }]);
      await doc(tx, "invoice", "t-inv-2", "2026-03-02", [{ item: "t-1", qty: 9, amount: 900 }], { deleted: true });
      const r = await rows(tx);
      expect(r.map((x) => x.doc_number)).toEqual(["T-INV-1"]);
    });
  });

  it("counts a SKU with no conversion as 0 eaches and flags it", async () => {
    await inRollback(async (tx) => {
      await item(tx, "t-1", "Wound Care:NOCONV1");
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [{ item: "t-1", qty: 3, amount: 30 }]);
      const [r] = await rows(tx);
      expect(r.eaches.toString()).toBe("0");
      expect(r.eaches_per_unit).toBeNull();
      expect(r.has_conversion).toBe(false);
    });
  });

  it("groups Amazon and pack variants under the base SKU but converts by their own SKU", async () => {
    await inRollback(async (tx) => {
      await item(tx, "t-1", "Wound Care:TSTSKU1");
      await item(tx, "t-2", "Amazon:TSTSKU1 - AMZ");
      await item(tx, "t-3", "Amazon:TSTSKU1-3PK-AMZ");
      await tx.skuConversion.createMany({
        data: [
          { sku: "TSTSKU1", eachesPerUnit: 25, updatedBy: "test" },
          { sku: "TSTSKU1 - AMZ", eachesPerUnit: 20, updatedBy: "test" },
          { sku: "TSTSKU1-3PK-AMZ", eachesPerUnit: 3, updatedBy: "test" },
        ],
      });
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [
        { item: "t-1", qty: 1, amount: 100 },
        { item: "t-2", qty: 1, amount: 100 },
        { item: "t-3", qty: 1, amount: 20 },
      ]);
      const r = await rows(tx);
      expect(r.map((x) => x.base_sku)).toEqual(["TSTSKU1", "TSTSKU1", "TSTSKU1"]);
      expect(r.map((x) => x.eaches.toString())).toEqual(["25", "20", "3"]);
      expect(r.map((x) => x.is_pack_variant)).toEqual([false, false, true]);
    });
  });

  it("marks non-product items", async () => {
    await inRollback(async (tx) => {
      await item(tx, "t-1", "Freight:Shipping");
      await item(tx, "t-2", "DISCOUNT");
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [
        { item: "t-1", qty: 1, amount: 85 },
        { item: "t-2", qty: 1, amount: -50 },
      ]);
      const r = await rows(tx);
      expect(r.every((x) => !x.is_product)).toBe(true);
    });
  });

  it("falls back to the last segment of the line's item name when the item hasn't synced", async () => {
    await inRollback(async (tx) => {
      await tx.skuConversion.create({ data: { sku: "TSTSKU9", eachesPerUnit: 10, updatedBy: "test" } });
      await doc(tx, "invoice", "t-inv-1", "2026-03-01", [
        { item: "not-synced", itemName: "Wound Care:Foam: TSTSKU9", qty: 2, amount: 20 },
      ]);
      const [r] = await rows(tx);
      expect(r.sku).toBe("TSTSKU9");
      expect(r.base_sku).toBe("TSTSKU9");
      expect(r.is_product).toBe(false);
      expect(r.eaches.toString()).toBe("20");
      expect(r.customer_name).toBe("Name From Invoice");
    });
  });

  it("allows only one running sync at a time", async () => {
    await inRollback(async (tx) => {
      await tx.syncRun.create({ data: { kind: "incremental", triggeredBy: "test" } });
      await expect(
        tx.$executeRaw`INSERT INTO sync_runs (kind, triggered_by) VALUES ('incremental', 'test2')`,
      ).rejects.toThrow(/sync_runs_one_running|unique/i);
    });
  });
});
