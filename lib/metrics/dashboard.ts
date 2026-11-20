import "server-only";
import type { Filters } from "./filters";
import {
  byPeriod,
  customerName,
  customerTable,
  dataAsOf,
  grid,
  missingConversions,
  totalsWithChange,
  skuTable,
  type CustomerRow,
  type SkuRow,
} from "./queries";

/** Everything the dashboard page renders, fetched in parallel. */
export async function getDashboard(f: Filters) {
  const [totals, periods, skus, customers, heat, missing, asOf, customerLabel] = await Promise.all([
    totalsWithChange(f),
    byPeriod(f),
    skuTable(f),
    customerTable(f),
    grid(f),
    missingConversions(f),
    dataAsOf(),
    f.customer ? customerName(f.customer) : Promise.resolve(null),
  ]);
  return {
    totals,
    periods,
    skus,
    customers,
    grid: heat,
    missing,
    asOf: asOf?.toISOString() ?? null,
    customerLabel,
    headline: headline(f, skus.rows, customers, customerLabel),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * One sentence written from the data, e.g. "REMSF99B leads with 45.7% of
 * product dollars; Lakeland Supplychain RDC is the largest customer at 51.3%."
 */
export function headline(f: Filters, skus: SkuRow[], customers: CustomerRow[], customerLabel: string | null): string {
  const topSku = [...skus].sort((a, b) => b.sales - a.sales)[0];
  const topCustomer = [...customers].sort((a, b) => b.sales - a.sales)[0];
  if (!topSku && !topCustomer) return "No sales in this date range.";

  if (f.customer) {
    const who = customerLabel ?? "This customer";
    return topSku && topSku.sales > 0
      ? `For ${who}, ${topSku.sku} leads with ${pct(topSku.pctOfSales)} of product dollars across ${skus.length} SKU${skus.length === 1 ? "" : "s"}.`
      : `${who} has no product sales in this range.`;
  }
  if (f.sku) {
    return topCustomer && topCustomer.sales > 0
      ? `${topCustomer.customer} buys the most ${f.sku}, at ${pct(topCustomer.pctOfSales)} of its dollars, among ${customers.length} customer${customers.length === 1 ? "" : "s"}.`
      : `No sales of ${f.sku} in this range.`;
  }
  const parts: string[] = [];
  if (topSku && topSku.sales > 0) parts.push(`${topSku.sku} leads with ${pct(topSku.pctOfSales)} of product dollars`);
  if (topCustomer && topCustomer.sales > 0) parts.push(`${topCustomer.customer} is the largest customer at ${pct(topCustomer.pctOfSales)}`);
  return parts.length ? `${parts.join("; ")}.` : "No sales in this date range.";
}
