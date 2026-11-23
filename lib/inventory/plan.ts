// Ordering rules for the Inventory dashboard. Pure functions, so they can be
// tested without a database.
//
// * Monthly usage = the greater of the usage the owner provides and the last
//   3 full months' average units sold (QuickBooks invoices net of credit memos).
// * Months on hand = available ÷ monthly usage.
// * A purchase order takes the SKU's lead time to arrive (60 days for SKUs
//   ending in B, 90 days for the rest), and stock must never fall below
//   FLOOR_MONTHS. So a SKU needs ordering once available plus on-order drops
//   below (FLOOR + lead time) months of usage, and the suggested order brings
//   it back to that level.

/** Default lead time: 90 days from PO to delivery. */
export const LEAD_TIME_DAYS = 90;
/** Lead time for SKUs ending in B. */
export const B_LEAD_TIME_DAYS = 60;
export const DAYS_PER_MONTH = 365.25 / 12;
export const LEAD_TIME_MONTHS = LEAD_TIME_DAYS / DAYS_PER_MONTH;
/** Never go below this many months on hand. */
export const FLOOR_MONTHS = 3;
/** Order when available + on order is below this many months of usage (default lead time). */
export const REORDER_MONTHS = FLOOR_MONTHS + LEAD_TIME_MONTHS;

/** Days from PO to delivery for a SKU: 60 when it ends in B, otherwise 90. */
export function leadTimeDaysFor(sku: string): number {
  return sku.trim().toUpperCase().endsWith("B") ? B_LEAD_TIME_DAYS : LEAD_TIME_DAYS;
}

/** Months of usage that stock plus open POs should cover for a lead time. */
export function reorderMonths(leadTimeDays: number): number {
  return FLOOR_MONTHS + leadTimeDays / DAYS_PER_MONTH;
}

export type Status = "below_floor" | "order_now" | "order_soon" | "ok" | "no_usage";

export const STATUS_LABEL: Record<Status, string> = {
  below_floor: "Below 3 months",
  order_now: "Order now",
  order_soon: "Order within 30 days",
  ok: "OK",
  no_usage: "No recent sales",
};

export interface PlanInput {
  /** Quantities in QuickBooks units (cases). */
  available: number;
  reserved: number;
  held: number;
  incoming: number;
  /** Owner-provided monthly usage, or null when there is none. */
  providedUsage: number | null;
  /** Units sold over the last 3 full months. */
  soldLast3Months: number;
  /** QuickBooks purchase cost per unit, or null. */
  unitCost: number | null;
  /** Days from PO to delivery; LEAD_TIME_DAYS when left out. */
  leadTimeDays?: number;
}

export interface Plan {
  leadTimeDays: number;
  onHand: number;
  monthlyUsage: number;
  usageSource: "provided" | "sales" | "none";
  avgLast3Months: number;
  monthsOnHand: number | null;
  /** (available + on order) ÷ usage */
  monthsWithIncoming: number | null;
  reorderPoint: number;
  suggestedOrder: number;
  /** Days from today until available + on order reaches the reorder point (0 = now). */
  orderInDays: number | null;
  status: Status;
  value: number | null;
}

export function plan(i: PlanInput): Plan {
  const leadTimeDays = i.leadTimeDays ?? LEAD_TIME_DAYS;
  const avg = Math.max(0, i.soldLast3Months) / 3;
  const provided = i.providedUsage !== null && i.providedUsage > 0 ? i.providedUsage : 0;
  const usage = Math.max(provided, avg);
  const usageSource: Plan["usageSource"] = usage === 0 ? "none" : provided >= avg ? "provided" : "sales";
  const available = Math.max(0, i.available);
  const onHand = available + Math.max(0, i.reserved) + Math.max(0, i.held);
  const position = available + Math.max(0, i.incoming);
  const value = i.unitCost === null ? null : onHand * i.unitCost;

  if (usage === 0) {
    return {
      leadTimeDays,
      onHand,
      monthlyUsage: 0,
      usageSource,
      avgLast3Months: avg,
      monthsOnHand: null,
      monthsWithIncoming: null,
      reorderPoint: 0,
      suggestedOrder: 0,
      orderInDays: null,
      status: "no_usage",
      value,
    };
  }

  const reorderPoint = reorderMonths(leadTimeDays) * usage;
  const suggestedOrder = position < reorderPoint ? Math.ceil(reorderPoint - position) : 0;
  const orderInDays = Math.max(0, Math.floor(((position - reorderPoint) / usage) * DAYS_PER_MONTH));
  const status: Status =
    available < FLOOR_MONTHS * usage ? "below_floor" : position < reorderPoint ? "order_now" : orderInDays <= 30 ? "order_soon" : "ok";

  return {
    leadTimeDays,
    onHand,
    monthlyUsage: usage,
    usageSource,
    avgLast3Months: avg,
    monthsOnHand: available / usage,
    monthsWithIncoming: position / usage,
    reorderPoint,
    suggestedOrder,
    orderInDays,
    status,
    value,
  };
}

/** The last 3 full calendar months before `today` (YYYY-MM-DD), as an inclusive range. */
export function lastThreeFullMonths(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const firstThisMonth = new Date(Date.UTC(y, m - 1, 1));
  const from = new Date(Date.UTC(y, m - 4, 1));
  const to = new Date(firstThisMonth.getTime() - 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Adds days to a YYYY-MM-DD date. */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
