import Link from "next/link";
import { requireViewer } from "@/lib/access";
import { prisma } from "@/lib/db";
import { todayCentral } from "@/lib/metrics/filters";
import { arSummary, arTrend, BUCKET_LABEL, BUCKETS, type Bucket } from "@/lib/ar/queries";
import { ArTrendChart } from "@/components/ar/trend-chart";
import { compactMoney, dayLabel, money } from "@/components/format";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Card({ title, subtitle, id, children }: { title: string; subtitle?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-secondary">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

const amt = (n: number) => (n === 0 ? "—" : money(n));
const th = "px-2 py-1.5 font-medium";
const td = "px-2 py-1.5";
const PAST_DUE_CLASS: Record<Bucket, string> = {
  current: "",
  d1_30: "",
  d31_60: "text-[var(--delta-bad)]",
  d61_90: "text-[var(--delta-bad)]",
  d90: "font-semibold text-[var(--delta-bad)]",
};

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireViewer();
  const params = await searchParams;
  const today = todayCentral();
  const [ar, trend, lastSync] = await Promise.all([
    arSummary(today),
    arTrend(today),
    prisma.syncRun.findFirst({ where: { status: "succeeded" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true } }),
  ]);

  const customerId = first(params.customer) ?? null;
  const customer = customerId ? ar.customers.find((c) => c.customerQboId === customerId) ?? null : null;
  const invoices = customer ? ar.invoices.filter((i) => i.customerQboId === customer.customerQboId) : ar.invoices;
  const { totals } = ar;
  const pctPastDue = totals.openInvoiceBalance > 0 ? (totals.pastDue / totals.openInvoiceBalance) * 100 : 0;
  const synced = lastSync?.finishedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(lastSync.finishedAt)
    : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Accounts Receivable</h1>
        <p className="text-sm text-secondary">
          As of {dayLabel(today, true)} · from QuickBooks, updated nightly{synced ? ` (last update ${synced})` : ""}. Credits and unapplied payments are
          netted against what each customer owes.
        </p>
      </header>

      {ar.missingDueDates > 0 && (
        <p role="alert" className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          Due dates and payments haven&apos;t been loaded from QuickBooks yet, so {ar.missingDueDates} invoice{ar.missingDueDates === 1 ? "" : "s"} are aged from
          the invoice date. The next sync loads them; an admin can run it now with Refresh on the admin page.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total AR" value={money(totals.net)} note={`${money(totals.openInvoiceBalance)} open invoices less ${money(totals.credits)} credits`} />
        <Stat label="Past due" value={money(totals.pastDue)} note={`${pctPastDue.toFixed(1)}% of open invoices`} />
        <Stat label="Over 90 days past due" value={money(totals.over90)} note={`${ar.customers.filter((c) => c.buckets.d90 > 0).length} customers`} />
        <Stat
          label="DSO"
          value={ar.dso === null ? "—" : `${Math.round(ar.dso)} days`}
          note={`Days sales outstanding: total AR vs ${compactMoney(ar.sales90)} invoiced in the last 90 days`}
        />
      </div>

      <Card title="AR over time" subtitle="At each month end for the last 12 months, and today">
        <ArTrendChart points={trend} today={today} />
      </Card>

      <Card title="Aging by customer" subtitle={`${ar.customers.length} customers with a balance · by days past due · click a customer to see their invoices`}>
        {ar.customers.length === 0 ? (
          <p className="text-sm text-secondary">No open invoices or credits.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="sticky top-0 bg-surface text-secondary">
                <tr className="border-b border-line">
                  <th className={th}>Customer</th>
                  {BUCKETS.map((b) => (
                    <th key={b} className={`${th} text-right`}>
                      {BUCKET_LABEL[b]}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>Credits</th>
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ar.customers.map((c) => (
                  <tr key={c.customerQboId} className={`border-b border-line last:border-0 ${c.customerQboId === customerId ? "bg-foreground/5" : ""}`}>
                    <td className={td}>
                      <Link href={`/receivables?customer=${encodeURIComponent(c.customerQboId)}#invoices`} className="underline-offset-4 hover:underline">
                        {c.customer}
                      </Link>
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={`${td} text-right tabular ${c.buckets[b] ? PAST_DUE_CLASS[b] : ""}`}>
                        {amt(c.buckets[b])}
                      </td>
                    ))}
                    <td className={`${td} text-right tabular`}>{c.credits ? `−${money(c.credits)}` : "—"}</td>
                    <td className={`${td} text-right font-semibold tabular`}>{money(c.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface">
                <tr className="border-t border-line font-semibold">
                  <td className={td}>Total</td>
                  {BUCKETS.map((b) => (
                    <td key={b} className={`${td} text-right tabular`}>
                      {amt(totals.buckets[b])}
                    </td>
                  ))}
                  <td className={`${td} text-right tabular`}>{totals.credits ? `−${money(totals.credits)}` : "—"}</td>
                  <td className={`${td} text-right tabular`}>{money(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card
        id="invoices"
        title={customer ? `Open invoices: ${customer.customer}` : "Open invoices"}
        subtitle={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"} · ${money(invoices.reduce((t, i) => t + i.balance, 0))} open · most overdue first`}
      >
        {customer && (
          <p className="text-sm">
            <Link href="/receivables#invoices" className="underline underline-offset-4 hover:opacity-80">
              Show all customers
            </Link>
            {customer.credits > 0 && <span className="text-secondary"> · {money(customer.credits)} in credits and unapplied payments not shown here</span>}
          </p>
        )}
        {invoices.length === 0 ? (
          <p className="text-sm text-secondary">No open invoices.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="sticky top-0 bg-surface text-secondary">
                <tr className="border-b border-line">
                  <th className={th}>Invoice</th>
                  {!customer && <th className={th}>Customer</th>}
                  <th className={th}>Date</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Days past due</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.qboId} className="border-b border-line last:border-0">
                    <td className={`${td} font-medium`}>{i.docNumber ?? "—"}</td>
                    {!customer && <td className={td}>{i.customer}</td>}
                    <td className={`${td} whitespace-nowrap`}>{dayLabel(i.txnDate, true)}</td>
                    <td className={`${td} whitespace-nowrap`}>{dayLabel(i.dueDate, true)}</td>
                    <td className={`${td} text-right tabular ${PAST_DUE_CLASS[i.bucket]}`}>{i.daysPastDue > 0 ? i.daysPastDue : "—"}</td>
                    <td className={`${td} text-right tabular`}>{money(i.total)}</td>
                    <td className={`${td} text-right font-semibold tabular`}>{money(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <details className="rounded-lg border border-line bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-semibold">How these numbers are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-secondary">
          <li>Open invoices are QuickBooks invoices with a balance. Days past due count from the invoice&apos;s due date to today.</li>
          <li>
            <em>Credits</em> are open credit memos and payments not yet applied to an invoice. They reduce each customer&apos;s total, so{" "}
            <em>Total AR</em> matches QuickBooks&apos; A/R Aging Summary, apart from journal entries posted straight to A/R.
          </li>
          <li>
            <em>Past due</em> and the aging columns count invoices only; credits aren&apos;t aged. <em>% past due</em> is past due ÷ open invoice balances.
          </li>
          <li>
            <em>DSO</em> = total AR ÷ the last 90 days&apos; invoices (less credit memos) × 90: roughly how many days of sales are waiting to be collected.
          </li>
          <li>
            <em>AR over time</em> works back from today&apos;s balances, undoing the invoices, credit memos and payments dated after each month end. Invoices and
            payments from before the sync start date aren&apos;t included.
          </li>
        </ul>
      </details>
    </main>
  );
}
