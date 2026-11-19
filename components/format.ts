// Number formatting for the dashboard. Display only; every calculation happens in SQL.

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

/** $3,569,612.00 */
export const money = (n: number) => usd2.format(n);
/** $3,569,612 */
export const money0 = (n: number) => usd0.format(n);
/** 22,170 (up to 2 decimals) */
export const qty = (n: number) => int.format(n);
/** $7.81M / 554K: big standalone numbers. Under 10,000 they stay in full. */
export const compactMoney = (n: number) => (Math.abs(n) < 10_000 ? usd0.format(n) : compactUsd.format(n));
export const compactQty = (n: number) => (Math.abs(n) < 10_000 ? int.format(n) : compact.format(n));
/** 47.4% */
export const pct = (n: number) => `${n.toFixed(1)}%`;

export type MeasureKey = "sales" | "units" | "eaches";
export const MEASURE_LABEL: Record<MeasureKey, string> = { sales: "Sales $", units: "Units", eaches: "Eaches" };
export const formatMeasure = (m: MeasureKey, n: number) => (m === "sales" ? money0(n) : qty(n));
export const compactMeasure = (m: MeasureKey, n: number) => (m === "sales" ? compactMoney(n) : compactQty(n));

/** "Jan 2026" from "2026-01-01" */
export function monthLabel(ymd: string, withYear = true) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
}
