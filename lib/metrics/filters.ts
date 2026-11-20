// Dashboard filters, kept in the URL query string so a link reproduces the
// view. Pure functions only (shared by the server page and the browser).

export const MEASURES = ["sales", "units", "eaches"] as const;
export type Measure = (typeof MEASURES)[number];

export const INTERVALS = ["month", "week"] as const;
export type Interval = (typeof INTERVALS)[number];

export const TIME_ZONE = "America/Chicago";

export interface Filters {
  /** Inclusive dates, YYYY-MM-DD, compared with invoices' TxnDate. */
  from: string;
  to: string;
  measure: Measure;
  /** customer_qbo_id */
  customer: string | null;
  /** SKU key: the base SKU, or the exact SKU with Amazon variants shown separately. */
  sku: string | null;
  /** Hide $0 lines (samples and replacements). */
  excludeZero: boolean;
  /** Show "REMSF99B - AMZ" separately instead of under REMSF99B. */
  amazonSeparate: boolean;
  /** Bars in the over-time chart: calendar months, or weeks starting Monday. */
  interval: Interval;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in the company's time zone. */
export function todayCentral(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The same calendar date a year earlier; Feb 29 becomes Feb 28. */
export function yearEarlier(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const prev = new Date(Date.UTC(y - 1, m - 1, d));
  if (prev.getUTCMonth() !== m - 1) prev.setUTCDate(0); // rolled into March
  return prev.toISOString().slice(0, 10);
}

export type Preset = "ytd" | "last90" | "lastYear" | "samePeriodLastYear";

export const PRESET_LABELS: Record<Preset, string> = {
  ytd: "Year to date",
  last90: "Last 90 days",
  lastYear: "Last year",
  samePeriodLastYear: "Same period last year",
};

export function presetRange(preset: Preset, current: { from: string; to: string }, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  switch (preset) {
    case "ytd":
      return { from: `${year}-01-01`, to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "lastYear":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "samePeriodLastYear":
      return { from: yearEarlier(current.from), to: yearEarlier(current.to) };
  }
}

/** Which preset (if any) the range matches, for highlighting it. */
export function activePreset(f: { from: string; to: string }, today: string): Preset | null {
  for (const p of ["ytd", "last90", "lastYear"] as const) {
    const r = presetRange(p, f, today);
    if (r.from === f.from && r.to === f.to) return p;
  }
  return null;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Reads filters from the query string. Anything invalid falls back to the default (year to date, Sales $). */
export function parseFilters(params: Params, today = todayCentral()): Filters {
  let from = get(params, "from");
  let to = get(params, "to");
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) {
    ({ from, to } = presetRange("ytd", { from: today, to: today }, today));
  }
  const measure = get(params, "measure");
  const customer = get(params, "customer");
  const sku = get(params, "sku");
  return {
    from,
    to,
    measure: (MEASURES as readonly string[]).includes(measure ?? "") ? (measure as Measure) : "sales",
    customer: customer && /^[\w.-]{1,64}$/.test(customer) ? customer : null,
    sku: sku && sku.length <= 120 ? sku : null,
    excludeZero: get(params, "zero") === "exclude",
    amazonSeparate: get(params, "amazon") === "separate",
    interval: get(params, "interval") === "week" ? "week" : "month",
  };
}

/** The query string for a set of filters, leaving defaults out so links stay short. */
export function filtersToQuery(f: Filters): string {
  const q = new URLSearchParams();
  q.set("from", f.from);
  q.set("to", f.to);
  if (f.measure !== "sales") q.set("measure", f.measure);
  if (f.customer) q.set("customer", f.customer);
  if (f.sku) q.set("sku", f.sku);
  if (f.excludeZero) q.set("zero", "exclude");
  if (f.amazonSeparate) q.set("amazon", "separate");
  if (f.interval === "week") q.set("interval", "week");
  return q.toString();
}

/** The same filters, one year earlier, for "change vs last year". */
export function priorYear(f: Filters): Filters {
  return { ...f, from: yearEarlier(f.from), to: yearEarlier(f.to) };
}
