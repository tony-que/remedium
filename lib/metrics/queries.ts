import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { priorYear, type Filters, type Measure } from "./filters";

// Every dashboard number, computed in SQL over the sales_lines view. The
// browser only formats results. Filter rules (SPEC.md, Calculations):
// * a customer filter narrows the SKU views; a SKU filter narrows the customer views
// * totals, the monthly chart and the grid apply both
// * SKU views (top SKUs, SKU table, grid) show product lines only, and their
//   % of $ is over product lines; totals, months and customer views include every line

type Scope = { customer?: boolean; sku?: boolean; productOnly?: boolean };

/** SQL for the SKU key: the base SKU, or the exact SKU when Amazon variants are separate. */
const skuKey = (f: Filters) => (f.amazonSeparate ? Prisma.sql`sku` : Prisma.sql`base_sku`);

function where(f: Filters, scope: Scope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`txn_date BETWEEN ${f.from}::date AND ${f.to}::date`];
  if (scope.customer && f.customer) parts.push(Prisma.sql`customer_qbo_id = ${f.customer}`);
  if (scope.sku && f.sku) parts.push(Prisma.sql`${skuKey(f)} = ${f.sku}`);
  if (scope.productOnly) parts.push(Prisma.sql`is_product`);
  if (f.excludeZero) parts.push(Prisma.sql`amount <> 0`);
  return Prisma.join(parts, " AND ");
}

const num = (d: Prisma.Decimal | string | number | bigint | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

/** The column that "measure" sorts and charts by. */
export function measureOf(row: { sales: number; units: number; eaches: number }, m: Measure): number {
  return m === "sales" ? row.sales : m === "units" ? row.units : row.eaches;
}

// ---------------------------------------------------------------------------

export interface Totals {
  sales: number;
  units: number;
  eaches: number;
  invoices: number;
  customers: number;
}

export async function totals(f: Filters): Promise<Totals> {
  const [r] = await prisma.$queryRaw<
    { sales: Prisma.Decimal | null; units: Prisma.Decimal | null; eaches: Prisma.Decimal | null; invoices: bigint; customers: bigint }[]
  >`
    SELECT sum(amount) sales, sum(qty) units, sum(eaches) eaches,
           count(DISTINCT invoice_qbo_id) FILTER (WHERE doc_type = 'invoice') invoices,
           count(DISTINCT customer_qbo_id) customers
    FROM sales_lines WHERE ${where(f, { customer: true, sku: true })}`;
  return { sales: num(r.sales), units: num(r.units), eaches: num(r.eaches), invoices: num(r.invoices), customers: num(r.customers) };
}

export interface TotalsWithChange {
  current: Totals;
  prior: Totals;
  /** (current − prior) ÷ prior; null when prior is 0. */
  change: Record<keyof Totals, number | null>;
}

export async function totalsWithChange(f: Filters): Promise<TotalsWithChange> {
  const [current, prior] = await Promise.all([totals(f), totals(priorYear(f))]);
  const change = Object.fromEntries(
    (Object.keys(current) as (keyof Totals)[]).map((k) => [k, prior[k] === 0 ? null : (current[k] - prior[k]) / prior[k]]),
  ) as TotalsWithChange["change"];
  return { current, prior, change };
}

// ---------------------------------------------------------------------------

export interface MonthRow {
  month: string; // YYYY-MM-01
  sales: number;
  units: number;
  eaches: number;
}

/**
 * By calendar month of the invoice date (TxnDate is already the company's
 * date, US Central). Every month in the range appears, with zeros for months
 * with no sales, so the time axis never skips.
 */
export async function byMonth(f: Filters): Promise<MonthRow[]> {
  const rows = await prisma.$queryRaw<{ month: Date; sales: Prisma.Decimal | null; units: Prisma.Decimal | null; eaches: Prisma.Decimal | null }[]>`
    WITH months AS (
      SELECT generate_series(date_trunc('month', ${f.from}::date), date_trunc('month', ${f.to}::date), interval '1 month')::date AS month
    ),
    sums AS (
      SELECT month, sum(amount) sales, sum(qty) units, sum(eaches) eaches
      FROM sales_lines WHERE ${where(f, { customer: true, sku: true })}
      GROUP BY month
    )
    SELECT m.month, s.sales, s.units, s.eaches FROM months m LEFT JOIN sums s USING (month) ORDER BY m.month`;
  return rows.map((r) => ({ month: r.month.toISOString().slice(0, 10), sales: num(r.sales), units: num(r.units), eaches: num(r.eaches) }));
}

// ---------------------------------------------------------------------------

export interface SkuRow {
  sku: string;
  category: string | null;
  description: string | null;
  units: number;
  eaches: number;
  sales: number;
  /** One conversion for every line, else null (see mixedConversion / missingConversion). */
  eachesPerUnit: number | null;
  mixedConversion: boolean;
  missingConversion: boolean;
  /** Grouped variants count packs on some lines and cases on others. */
  mixesPacks: boolean;
  /** Sales $ ÷ Units; null when units are 0. */
  avgPrice: number | null;
  /** Share of product dollars in the current selection, 0–100. */
  pctOfSales: number;
}

export interface SkuTable {
  rows: SkuRow[];
  productSales: number;
  /** Dollars on non-product lines left out of the SKU views. */
  nonProductSales: number;
}

export async function skuTable(f: Filters): Promise<SkuTable> {
  const key = skuKey(f);
  const [rows, [np]] = await Promise.all([
    prisma.$queryRaw<
      {
        sku: string;
        category: string | null;
        description: string | null;
        units: Prisma.Decimal;
        eaches: Prisma.Decimal;
        sales: Prisma.Decimal;
        epu_min: number | null;
        epu_max: number | null;
        missing: boolean;
        has_pack: boolean;
        has_case: boolean;
      }[]
    >`
      SELECT ${key} AS sku,
             max(category) category,
             (array_agg(description ORDER BY txn_date DESC, line_id DESC) FILTER (WHERE description IS NOT NULL))[1] description,
             sum(qty) units, sum(eaches) eaches, sum(amount) sales,
             min(eaches_per_unit) epu_min, max(eaches_per_unit) epu_max,
             bool_or(NOT has_conversion) missing,
             bool_or(is_pack_variant) has_pack, bool_or(NOT is_pack_variant) has_case
      FROM sales_lines WHERE ${where(f, { customer: true, productOnly: true })}
      GROUP BY ${key}`,
    prisma.$queryRaw<{ sales: Prisma.Decimal | null }[]>`
      SELECT sum(amount) sales FROM sales_lines
      WHERE ${where(f, { customer: true })} AND NOT is_product`,
  ]);
  const productSales = rows.reduce((s, r) => s + num(r.sales), 0);
  return {
    productSales,
    nonProductSales: num(np.sales),
    rows: rows.map((r) => {
      const units = num(r.units);
      const sales = num(r.sales);
      const single = r.epu_min !== null && r.epu_min === r.epu_max && !r.missing;
      return {
        sku: r.sku,
        category: r.category,
        description: r.description,
        units,
        eaches: num(r.eaches),
        sales,
        eachesPerUnit: single ? r.epu_min : null,
        mixedConversion: r.epu_min !== null && r.epu_min !== r.epu_max,
        missingConversion: r.missing,
        mixesPacks: r.has_pack && r.has_case,
        avgPrice: units === 0 ? null : sales / units,
        pctOfSales: productSales === 0 ? 0 : (sales / productSales) * 100,
      };
    }),
  };
}

// ---------------------------------------------------------------------------

export interface CustomerRow {
  customerId: string;
  customer: string;
  units: number;
  eaches: number;
  sales: number;
  invoices: number;
  skusBought: number;
  pctOfSales: number;
}

export async function customerTable(f: Filters): Promise<CustomerRow[]> {
  const key = skuKey(f);
  const rows = await prisma.$queryRaw<
    { customer_id: string; customer: string; units: Prisma.Decimal; eaches: Prisma.Decimal; sales: Prisma.Decimal; invoices: bigint; skus: bigint }[]
  >`
    SELECT customer_qbo_id customer_id, max(customer_name) customer,
           sum(qty) units, sum(eaches) eaches, sum(amount) sales,
           count(DISTINCT invoice_qbo_id) FILTER (WHERE doc_type = 'invoice') invoices,
           count(DISTINCT ${key}) FILTER (WHERE is_product) skus
    FROM sales_lines WHERE ${where(f, { sku: true })}
    GROUP BY customer_qbo_id`;
  const total = rows.reduce((s, r) => s + num(r.sales), 0);
  return rows.map((r) => ({
    customerId: r.customer_id,
    customer: r.customer,
    units: num(r.units),
    eaches: num(r.eaches),
    sales: num(r.sales),
    invoices: num(r.invoices),
    skusBought: num(r.skus),
    pctOfSales: total === 0 ? 0 : (num(r.sales) / total) * 100,
  }));
}

// ---------------------------------------------------------------------------

export interface Grid {
  skus: string[];
  rows: { customerId: string; customer: string; total: number; cells: Record<string, number> }[];
  max: number;
}

/** Customers × top SKUs in the chosen measure. Product lines; both filters apply. */
export async function grid(f: Filters, topN = 10): Promise<Grid> {
  const key = skuKey(f);
  const w = where(f, { customer: true, sku: true, productOnly: true });
  const col = f.measure === "sales" ? Prisma.sql`amount` : f.measure === "units" ? Prisma.sql`qty` : Prisma.sql`eaches`;
  const rows = await prisma.$queryRaw<{ sku: string; customer_id: string; customer: string; value: Prisma.Decimal }[]>`
    WITH top AS (
      SELECT ${key} AS sku FROM sales_lines WHERE ${w}
      GROUP BY 1 ORDER BY sum(${col}) DESC, 1 LIMIT ${topN}
    )
    SELECT ${key} AS sku, customer_qbo_id customer_id, max(customer_name) customer, sum(${col}) value
    FROM sales_lines WHERE ${w} AND ${key} IN (SELECT sku FROM top)
    GROUP BY 1, 2`;
  const skuTotals = new Map<string, number>();
  const byCustomer = new Map<string, Grid["rows"][number]>();
  let max = 0;
  for (const r of rows) {
    const v = num(r.value);
    skuTotals.set(r.sku, (skuTotals.get(r.sku) ?? 0) + v);
    const row = byCustomer.get(r.customer_id) ?? { customerId: r.customer_id, customer: r.customer, total: 0, cells: {} };
    row.cells[r.sku] = v;
    row.total += v;
    byCustomer.set(r.customer_id, row);
    max = Math.max(max, v);
  }
  return {
    skus: [...skuTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s),
    rows: [...byCustomer.values()].sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer)),
    max,
  };
}

// ---------------------------------------------------------------------------

/** Product SKUs sold in the date range with no eaches conversion (they count 0 eaches). */
export async function missingConversions(f: Filters): Promise<{ sku: string; units: number }[]> {
  const rows = await prisma.$queryRaw<{ sku: string; units: Prisma.Decimal }[]>`
    SELECT sku, sum(qty) units FROM sales_lines
    WHERE ${where({ ...f, customer: null, sku: null }, { productOnly: true })} AND NOT has_conversion
    GROUP BY sku HAVING sum(qty) <> 0 ORDER BY sum(qty) DESC, sku`;
  return rows.map((r) => ({ sku: r.sku, units: num(r.units) }));
}

/** When the data was last refreshed: the last successful sync's finish time. */
export async function dataAsOf(): Promise<Date | null> {
  const run = await prisma.syncRun.findFirst({ where: { status: "succeeded" }, orderBy: { finishedAt: "desc" } });
  return run?.finishedAt ?? null;
}

/** The display name for a customer id (for the filter chip). */
export async function customerName(id: string): Promise<string | null> {
  const c = await prisma.customer.findUnique({ where: { qboId: id } });
  if (c) return c.displayName;
  const inv = await prisma.invoice.findFirst({ where: { customerQboId: id }, select: { customerName: true } });
  return inv?.customerName ?? null;
}

// ---------------------------------------------------------------------------

export interface FlatLine {
  txnDate: string;
  docType: string;
  docNumber: string | null;
  customer: string;
  sku: string;
  baseSku: string;
  category: string | null;
  isProduct: boolean;
  description: string | null;
  qty: string;
  unitPrice: string;
  amount: string;
  eachesPerUnit: number | null;
  eaches: string;
}

/** Every line behind the totals (both filters), with exact decimal strings, for CSV export. */
export async function flatLines(f: Filters): Promise<FlatLine[]> {
  const rows = await prisma.$queryRaw<
    {
      txn_date: Date;
      doc_type: string;
      doc_number: string | null;
      customer_name: string;
      sku: string;
      base_sku: string;
      category: string | null;
      is_product: boolean;
      description: string | null;
      qty: string;
      unit_price: string;
      amount: string;
      eaches_per_unit: number | null;
      eaches: string;
    }[]
  >`
    SELECT txn_date, doc_type::text, doc_number, customer_name, sku, base_sku, category, is_product, description,
           qty::text, unit_price::text, amount::text, eaches_per_unit, eaches::text
    FROM sales_lines WHERE ${where(f, { customer: true, sku: true })}
    ORDER BY txn_date, doc_number, line_id`;
  return rows.map((r) => ({
    txnDate: r.txn_date.toISOString().slice(0, 10),
    docType: r.doc_type,
    docNumber: r.doc_number,
    customer: r.customer_name,
    sku: r.sku,
    baseSku: r.base_sku,
    category: r.category,
    isProduct: r.is_product,
    description: r.description,
    qty: r.qty,
    unitPrice: r.unit_price,
    amount: r.amount,
    eachesPerUnit: r.eaches_per_unit,
    eaches: r.eaches,
  }));
}
