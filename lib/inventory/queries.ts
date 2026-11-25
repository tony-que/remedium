import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { productLineOf } from "@/lib/items";
import type { ProductLine } from "@/lib/metrics/filters";
import { lastThreeFullMonths, leadTimeDaysFor, plan, type Plan } from "./plan";

// Inventory rows for the dashboard: QuickBooks stock (quantity on hand, on
// purchase orders, on sales orders) joined to items (cost, category, product
// flag), eaches conversions, the owner's monthly usage, and the last 3 full
// months of invoiced units. Every quantity is in QuickBooks units (cases).

export interface InventoryRow extends Plan {
  sku: string;
  name: string | null;
  category: string | null;
  line: ProductLine;
  isProduct: boolean;
  /** Quantities in cases (QuickBooks units). */
  available: number;
  reserved: number;
  incoming: number;
  backordered: number;
  eachesPerUnit: number | null;
  unitCost: number | null;
  providedUsage: number | null;
}

const num = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const numOrNull = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? null : Number(d));

export async function inventoryRows(today: string): Promise<InventoryRow[]> {
  const { from, to } = lastThreeFullMonths(today);
  const rows = await prisma.$queryRaw<
    {
      sku: string;
      name: string | null;
      qty_available: Prisma.Decimal;
      qty_reserved: Prisma.Decimal;
      qty_held: Prisma.Decimal;
      qty_incoming: Prisma.Decimal;
      qty_backordered: Prisma.Decimal;
      category: string | null;
      is_product: boolean | null;
      purchase_cost: Prisma.Decimal | null;
      eaches_per_unit: number | null;
      monthly_units: Prisma.Decimal | null;
      sold: Prisma.Decimal | null;
    }[]
  >`
    WITH it AS (
      SELECT DISTINCT ON (upper(btrim(sku))) upper(btrim(sku)) AS k, category, is_product, purchase_cost
      FROM items ORDER BY upper(btrim(sku)), active DESC, (purchase_cost IS NOT NULL) DESC, updated_at DESC
    ),
    sold AS (
      SELECT upper(btrim(sku)) AS k, sum(qty) AS units FROM sales_lines
      WHERE txn_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    )
    SELECT il.sku, il.name, il.qty_available, il.qty_reserved, il.qty_held, il.qty_incoming, il.qty_backordered,
           it.category, it.is_product, it.purchase_cost, sc.eaches_per_unit, su.monthly_units, sold.units AS sold
    FROM inventory_levels il
    LEFT JOIN it ON it.k = upper(btrim(il.sku))
    LEFT JOIN sku_conversions sc ON upper(btrim(sc.sku)) = upper(btrim(il.sku))
    LEFT JOIN sku_usage su ON upper(btrim(su.sku)) = upper(btrim(il.sku))
    LEFT JOIN sold ON sold.k = upper(btrim(il.sku))
    ORDER BY il.sku`;

  return rows.map((r) => {
    const epu = r.eaches_per_unit && r.eaches_per_unit > 0 ? r.eaches_per_unit : null;
    const available = num(r.qty_available);
    const reserved = num(r.qty_reserved);
    const held = num(r.qty_held);
    const incoming = num(r.qty_incoming);
    const unitCost = numOrNull(r.purchase_cost);
    const providedUsage = numOrNull(r.monthly_units);
    const p = plan({ available, reserved, held, incoming, providedUsage, soldLast3Months: num(r.sold), unitCost, leadTimeDays: leadTimeDaysFor(r.sku) });
    return {
      ...p,
      sku: r.sku,
      name: r.name,
      category: r.category,
      line: productLineOf(r.sku),
      isProduct: r.is_product ?? true,
      available,
      reserved,
      incoming,
      backordered: num(r.qty_backordered),
      eachesPerUnit: epu,
      unitCost,
      providedUsage,
    };
  });
}

export interface OpenPo {
  /** Null on category lines and items not in the item list. */
  sku: string | null;
  /** The item's or expense account's name on the PO line. */
  itemName: string | null;
  description: string | null;
  /** Null when there's no SKU. */
  line: ProductLine | null;
  /** True when the line counts toward the SKU's "On open POs". */
  counted: boolean;
  docNumber: string | null;
  vendor: string | null;
  /** YYYY-MM-DD */
  txnDate: string;
  expectedDate: string | null;
  /** Null on lines without a quantity. */
  ordered: number | null;
  remaining: number | null;
  /** PO line dollar amount, or null. */
  amount: number | null;
  /** Dollars still to receive, or null. */
  openAmount: number | null;
}

/** Every open purchase order line still to receive, soonest expected first, then by PO. */
export async function openPurchaseOrders(): Promise<OpenPo[]> {
  const rows = await prisma.openPoLine.findMany({
    orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }, { txnDate: "asc" }, { docNumber: "asc" }, { lineId: "asc" }],
  });
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  const n = (x: { toString(): string } | null) => (x === null ? null : Number(x));
  return rows.map((r) => ({
    sku: r.sku,
    itemName: r.itemName,
    description: r.description,
    line: r.sku ? productLineOf(r.sku) : null,
    counted: r.counted,
    docNumber: r.docNumber,
    vendor: r.vendor,
    txnDate: d(r.txnDate)!,
    expectedDate: d(r.expectedDate),
    ordered: n(r.qtyOrdered),
    remaining: n(r.qtyRemaining),
    amount: n(r.amount),
    openAmount: n(r.openAmount),
  }));
}

export async function lastInventorySync() {
  const [success, latest] = await Promise.all([
    prisma.inventorySyncRun.findFirst({ where: { status: "succeeded" }, orderBy: { startedAt: "desc" } }),
    prisma.inventorySyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  return { success, latest };
}
