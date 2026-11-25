import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

// Accounts Receivable, from the synced invoices, credit memos and payments.
//
// * Open invoices: invoices with a balance. Days past due counts from the due
//   date (the invoice date when QuickBooks has none) to today.
// * Credits: open credit memo balances and unapplied payments. They reduce
//   what each customer owes, so the net total matches QuickBooks' A/R Aging
//   Summary (apart from journal entries to A/R, which aren't synced).
// * Trend: AR at each past month end, worked back from today's balances by
//   undoing what happened after that date: invoices and credit memos raised,
//   and payments received (and what each was applied to).

export const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90: "Over 90 days",
};

export function bucketOf(daysPastDue: number): Bucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90";
}

const MS_PER_DAY = 86_400_000;
const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / MS_PER_DAY;
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100) / 100;

export interface OpenInvoice {
  qboId: string;
  docNumber: string | null;
  customerQboId: string;
  customer: string;
  txnDate: string;
  dueDate: string;
  /** True when QuickBooks' due date hasn't been synced yet (the invoice date is used). */
  dueDateMissing: boolean;
  daysPastDue: number;
  bucket: Bucket;
  total: number;
  balance: number;
}

export interface CustomerAging {
  customerQboId: string;
  customer: string;
  buckets: Record<Bucket, number>;
  /** Open credit memos and unapplied payments, as a positive number. */
  credits: number;
  /** Open invoices less credits. */
  net: number;
  openInvoices: number;
  oldestDaysPastDue: number | null;
}

export interface ArSummary {
  invoices: OpenInvoice[];
  customers: CustomerAging[];
  totals: { buckets: Record<Bucket, number>; credits: number; openInvoiceBalance: number; net: number; pastDue: number; over90: number };
  /** Invoice totals less credit memo totals over the last 90 days. */
  sales90: number;
  /** Days sales outstanding: net AR ÷ last 90 days' sales × 90; null without sales. */
  dso: number | null;
  missingDueDates: number;
}

const emptyBuckets = (): Record<Bucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 });

export async function arSummary(today: string): Promise<ArSummary> {
  const [invRows, creditRows, salesRow] = await Promise.all([
    prisma.$queryRaw<
      {
        qbo_id: string;
        doc_number: string | null;
        customer_qbo_id: string;
        customer: string;
        txn_date: Date;
        due_date: Date | null;
        total_amt: Prisma.Decimal;
        balance: Prisma.Decimal;
      }[]
    >`
      SELECT i.qbo_id, i.doc_number, i.customer_qbo_id,
             coalesce(c.display_name, i.customer_name, '(customer ' || i.customer_qbo_id || ')') AS customer,
             i.txn_date, i.due_date, i.total_amt, i.balance
        FROM invoices i
        LEFT JOIN customers c ON c.qbo_id = i.customer_qbo_id
       WHERE i.doc_type = 'invoice' AND NOT i.deleted AND i.balance <> 0`,
    prisma.$queryRaw<{ customer_qbo_id: string; customer: string; credits: Prisma.Decimal }[]>`
      WITH cr AS (
        SELECT customer_qbo_id, customer_name, balance AS amt FROM invoices
         WHERE doc_type = 'credit_memo' AND NOT deleted AND balance > 0
        UNION ALL
        SELECT customer_qbo_id, customer_name, unapplied_amt FROM payments
         WHERE NOT deleted AND unapplied_amt > 0
      )
      SELECT cr.customer_qbo_id,
             coalesce(c.display_name, max(cr.customer_name), '(customer ' || cr.customer_qbo_id || ')') AS customer,
             sum(cr.amt) AS credits
        FROM cr LEFT JOIN customers c ON c.qbo_id = cr.customer_qbo_id
       GROUP BY cr.customer_qbo_id, c.display_name`,
    prisma.$queryRaw<{ sales: Prisma.Decimal | null }[]>`
      SELECT sum(CASE WHEN doc_type = 'invoice' THEN total_amt ELSE -total_amt END) AS sales
        FROM invoices
       WHERE NOT deleted AND txn_date > ${today}::date - 90 AND txn_date <= ${today}::date`,
  ]);

  const invoices: OpenInvoice[] = invRows.map((r) => {
    const due = ymd(r.due_date ?? r.txn_date);
    const daysPastDue = daysBetween(due, today);
    return {
      qboId: r.qbo_id,
      docNumber: r.doc_number,
      customerQboId: r.customer_qbo_id,
      customer: r.customer,
      txnDate: ymd(r.txn_date),
      dueDate: due,
      dueDateMissing: r.due_date === null,
      daysPastDue,
      bucket: bucketOf(daysPastDue),
      total: Number(r.total_amt),
      balance: Number(r.balance),
    };
  });
  invoices.sort((a, b) => b.daysPastDue - a.daysPastDue || b.balance - a.balance);

  const byCustomer = new Map<string, CustomerAging>();
  const row = (id: string, name: string) => {
    let c = byCustomer.get(id);
    if (!c) {
      c = { customerQboId: id, customer: name, buckets: emptyBuckets(), credits: 0, net: 0, openInvoices: 0, oldestDaysPastDue: null };
      byCustomer.set(id, c);
    }
    return c;
  };
  for (const i of invoices) {
    const c = row(i.customerQboId, i.customer);
    c.buckets[i.bucket] += i.balance;
    c.openInvoices++;
    if (i.daysPastDue > 0) c.oldestDaysPastDue = Math.max(c.oldestDaysPastDue ?? 0, i.daysPastDue);
  }
  for (const r of creditRows) row(r.customer_qbo_id, r.customer).credits += Number(r.credits);

  const totals = { buckets: emptyBuckets(), credits: 0, openInvoiceBalance: 0, net: 0, pastDue: 0, over90: 0 };
  const customers = [...byCustomer.values()].map((c) => {
    for (const b of BUCKETS) c.buckets[b] = cents(c.buckets[b]);
    c.credits = cents(c.credits);
    const open = BUCKETS.reduce((t, b) => t + c.buckets[b], 0);
    c.net = cents(open - c.credits);
    for (const b of BUCKETS) totals.buckets[b] += c.buckets[b];
    totals.credits += c.credits;
    totals.openInvoiceBalance += open;
    return c;
  });
  customers.sort((a, b) => b.net - a.net || a.customer.localeCompare(b.customer));
  for (const b of BUCKETS) totals.buckets[b] = cents(totals.buckets[b]);
  totals.credits = cents(totals.credits);
  totals.openInvoiceBalance = cents(totals.openInvoiceBalance);
  totals.net = cents(totals.openInvoiceBalance - totals.credits);
  totals.pastDue = cents(totals.openInvoiceBalance - totals.buckets.current);
  totals.over90 = totals.buckets.d90;

  const sales90 = cents(Number(salesRow[0]?.sales ?? 0));
  return {
    invoices,
    customers,
    totals,
    sales90,
    dso: sales90 > 0 ? (totals.net / sales90) * 90 : null,
    missingDueDates: invoices.filter((i) => i.dueDateMissing).length,
  };
}

export interface ArTrendPoint {
  /** YYYY-MM-DD: a month end, or today for the last point. */
  asOf: string;
  net: number;
  pastDue: number;
}

/** Month ends for the last `months` months, then today; none before `earliest`. */
export function trendDates(today: string, months: number, earliest: string | null): string[] {
  const out: string[] = [];
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7) - 1;
  for (let k = months; k >= 1; k--) {
    const end = ymd(new Date(Date.UTC(y, m - k + 1, 0)));
    if (!earliest || end >= earliest) out.push(end);
  }
  out.push(today);
  return out;
}

/** Net AR and past-due invoice balances at each date, worked back from today's balances. */
export async function arTrend(today: string, months = 12): Promise<ArTrendPoint[]> {
  const [first] = await prisma.$queryRaw<{ d: Date | null }[]>`SELECT min(txn_date) AS d FROM invoices WHERE NOT deleted`;
  const dates = trendDates(today, months, first?.d ? ymd(first.d) : null);
  const values = Prisma.join(dates.map((d) => Prisma.sql`(${d}::date)`));
  const rows = await prisma.$queryRaw<{ as_of: Date; net: Prisma.Decimal; past_due: Prisma.Decimal }[]>`
    WITH d(as_of) AS (VALUES ${values}),
    now_ar AS (
      SELECT (SELECT coalesce(sum(balance), 0) FROM invoices WHERE doc_type = 'invoice' AND NOT deleted)
           - (SELECT coalesce(sum(balance), 0) FROM invoices WHERE doc_type = 'credit_memo' AND NOT deleted)
           - (SELECT coalesce(sum(unapplied_amt), 0) FROM payments WHERE NOT deleted) AS net
    ),
    applied AS (
      SELECT pl.txn_id, p.txn_date, pl.amount
        FROM payment_links pl JOIN payments p ON p.qbo_id = pl.payment_qbo_id
       WHERE NOT p.deleted AND pl.txn_type = 'Invoice'
    )
    SELECT d.as_of,
           (SELECT net FROM now_ar)
           - (SELECT coalesce(sum(CASE WHEN doc_type = 'invoice' THEN total_amt ELSE -total_amt END), 0)
                FROM invoices WHERE NOT deleted AND txn_date > d.as_of)
           + (SELECT coalesce(sum(total_amt), 0) FROM payments WHERE NOT deleted AND txn_date > d.as_of) AS net,
           (SELECT coalesce(sum(greatest(0, least(i.total_amt,
                      i.balance + coalesce((SELECT sum(a.amount) FROM applied a WHERE a.txn_id = i.qbo_id AND a.txn_date > d.as_of), 0)))), 0)
              FROM invoices i
             WHERE i.doc_type = 'invoice' AND NOT i.deleted AND i.txn_date <= d.as_of
               AND coalesce(i.due_date, i.txn_date) < d.as_of) AS past_due
      FROM d
     ORDER BY d.as_of`;
  return rows.map((r) => ({ asOf: ymd(r.as_of), net: cents(Number(r.net)), pastDue: cents(Number(r.past_due)) }));
}
