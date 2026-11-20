import Link from "next/link";
import { requireViewer } from "@/lib/access";
import { PRODUCT_LINE_LABELS, PRODUCT_LINES, todayCentral, type ProductLine } from "@/lib/metrics/filters";
import { inventoryRows, lastInventorySync, type InventoryRow } from "@/lib/inventory/queries";
import { addDaysYmd, FLOOR_MONTHS, LEAD_TIME_DAYS, REORDER_MONTHS, STATUS_LABEL, type Status } from "@/lib/inventory/plan";
import { orderwerksConfigured } from "@/lib/orderwerks/client";
import { compactMoney, dayLabel, money, qty } from "@/components/format";

export const dynamic = "force-dynamic";

type Unit = "cases" | "eaches";
type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function parse(p: Params): { line: ProductLine | null; unit: Unit } {
  const line = first(p.line);
  return {
    line: (PRODUCT_LINES as readonly string[]).includes(line ?? "") ? (line as ProductLine) : null,
    unit: first(p.unit) === "eaches" ? "eaches" : "cases",
  };
}

function href(f: { line: ProductLine | null; unit: Unit }) {
  const q = new URLSearchParams();
  if (f.line) q.set("line", f.line);
  if (f.unit === "eaches") q.set("unit", "eaches");
  const s = q.toString();
  return s ? `/inventory?${s}` : "/inventory";
}

const segBase = "px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md border border-line -ml-px first:ml-0";
const seg = (on: boolean) => `${segBase} ${on ? "z-10 border-foreground bg-foreground text-background" : "bg-surface hover:bg-foreground/5"}`;

const STATUS_CLASS: Record<Status, string> = {
  below_floor: "bg-[var(--delta-bad)]/15 text-[var(--delta-bad)]",
  order_now: "bg-[var(--warn-bg)] text-foreground border border-[var(--warn-border)]",
  order_soon: "bg-foreground/5 text-foreground",
  ok: "text-[var(--delta-good)]",
  no_usage: "text-muted",
};

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
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

const months = (n: number | null) => (n === null ? "—" : n >= 99 ? "99+" : n.toFixed(1));

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireViewer();
  const f = parse(await searchParams);
  const today = todayCentral();
  const configured = orderwerksConfigured();
  const [all, sync] = await Promise.all([inventoryRows(today), lastInventorySync()]);

  // Quantities are kept in cases; eaches multiplies by each SKU's conversion.
  const show = (r: InventoryRow, cases: number) =>
    f.unit === "cases" ? qty(Math.round(cases * 100) / 100) : r.eachesPerUnit ? qty(Math.round(cases * r.eachesPerUnit)) : "—";
  const unitLabel = f.unit === "cases" ? "cases" : "eaches";

  const rows = all.filter((r) => !f.line || r.line === f.line);
  const alerts = rows
    .filter((r) => r.status === "below_floor" || r.status === "order_now" || r.status === "order_soon")
    .sort((a, b) => (a.orderInDays ?? 0) - (b.orderInDays ?? 0) || (a.monthsOnHand ?? 0) - (b.monthsOnHand ?? 0) || a.sku.localeCompare(b.sku));
  const byMonths = [...rows].sort((a, b) => (a.monthsOnHand ?? Infinity) - (b.monthsOnHand ?? Infinity) || a.sku.localeCompare(b.sku));
  const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const noCost = rows.filter((r) => r.value === null && r.onHand > 0).length;
  const toOrder = rows.filter((r) => r.status === "below_floor" || r.status === "order_now").length;
  const belowFloor = rows.filter((r) => r.status === "below_floor").length;
  const missingConversion = all.filter((r) => r.missingConversion).map((r) => r.sku);
  const valueByLine = PRODUCT_LINES.map((line) => {
    const rs = all.filter((r) => r.line === line);
    return { line, skus: rs.length, value: rs.reduce((s, r) => s + (r.value ?? 0), 0), onHand: rs.reduce((s, r) => s + r.onHand, 0) };
  });

  const asOf = sync.success?.finishedAt
    ? `Stock as of ${sync.success.finishedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })} CT`
    : "No inventory synced yet";

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted">{asOf}</p>
        </div>
        <p className="text-secondary">
          Order when stock plus open POs drops below about {REORDER_MONTHS.toFixed(0)} months of usage: {LEAD_TIME_DAYS} days to arrive, and never under{" "}
          {FLOOR_MONTHS} months on hand.
        </p>
      </header>

      {!configured && (
        <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>
          <strong>Orderwerks isn&apos;t connected yet.</strong> An admin adds the Orderwerks API key and secret in Vercel; the admin page has the steps.
        </div>
      )}
      {sync.latest?.status === "failed" && (
        <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>
          <strong>The last inventory sync failed</strong>, so these figures may be out of date: {sync.latest.error}
        </div>
      )}
      {missingConversion.length > 0 && (
        <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>
          Orderwerks counts eaches, but these SKUs have no eaches conversion, so their stock shows as 0: {missingConversion.join(", ")}.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div role="group" aria-label="Product line" className="flex flex-wrap">
          <Link href={href({ ...f, line: null })} aria-current={f.line === null ? "true" : undefined} className={seg(f.line === null)}>
            All lines
          </Link>
          {PRODUCT_LINES.map((line) => (
            <Link key={line} href={href({ ...f, line })} aria-current={f.line === line ? "true" : undefined} className={seg(f.line === line)}>
              {PRODUCT_LINE_LABELS[line]}
            </Link>
          ))}
        </div>
        <div role="group" aria-label="Units" className="flex">
          {(["cases", "eaches"] as const).map((u) => (
            <Link key={u} href={href({ ...f, unit: u })} aria-current={f.unit === u ? "true" : undefined} className={seg(f.unit === u)}>
              {u === "cases" ? "Cases" : "Eaches"}
            </Link>
          ))}
        </div>
      </div>

      {all.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-secondary">
          No stock levels yet. Once Orderwerks is connected, inventory refreshes every hour, or an admin can press Refresh inventory now on the admin page.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Inventory value" value={compactMoney(totalValue)} note={noCost ? `${noCost} SKU${noCost === 1 ? "" : "s"} with no QuickBooks cost left out` : "On hand × QuickBooks cost"} />
            <Stat label={`On hand (${unitLabel})`} value={f.unit === "cases" ? qty(Math.round(rows.reduce((s, r) => s + r.onHand, 0))) : qty(Math.round(rows.reduce((s, r) => s + r.onHand * (r.eachesPerUnit ?? 0), 0)))} note={`${rows.length} SKUs`} />
            <Stat label="SKUs to order now" value={String(toOrder)} note={`Stock plus open POs under ${REORDER_MONTHS.toFixed(0)} months`} />
            <Stat label="Below 3 months on hand" value={String(belowFloor)} note="Available stock alone" />
          </div>

          <Card title="Reorder alerts" subtitle={`${alerts.length} SKU${alerts.length === 1 ? "" : "s"} to order now or within 30 days · suggested order brings stock plus open POs back to about ${REORDER_MONTHS.toFixed(0)} months`}>
            {alerts.length === 0 ? (
              <p className="text-sm text-secondary">Nothing needs ordering in the next 30 days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="text-secondary">
                    <tr className="border-b border-line">
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 text-right font-medium">Available</th>
                      <th className="px-2 py-1.5 text-right font-medium">On open POs</th>
                      <th className="px-2 py-1.5 text-right font-medium">Usage / month</th>
                      <th className="px-2 py-1.5 text-right font-medium">Months on hand</th>
                      <th className="px-2 py-1.5 text-right font-medium">With POs</th>
                      <th className="px-2 py-1.5 text-right font-medium">Suggested order</th>
                      <th className="px-2 py-1.5 font-medium">Order by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((r) => (
                      <tr key={r.sku} className="border-b border-line last:border-0">
                        <td className="px-2 py-1.5">
                          <span className="font-medium">{r.sku}</span>
                          {r.name && <span className="block text-xs text-muted">{r.name}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular">{show(r, r.available)}</td>
                        <td className="px-2 py-1.5 text-right tabular">{show(r, r.incoming)}</td>
                        <td className="px-2 py-1.5 text-right tabular">
                          {show(r, r.monthlyUsage)}
                          <span className="block text-xs text-muted">{r.usageSource === "provided" ? "your table" : "last 3 months"}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular">{months(r.monthsOnHand)}</td>
                        <td className="px-2 py-1.5 text-right tabular">{months(r.monthsWithIncoming)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular">{r.suggestedOrder > 0 ? show(r, r.suggestedOrder) : "—"}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{r.orderInDays === 0 ? "Now" : dayLabel(addDaysYmd(today, r.orderInDays ?? 0), true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Inventory value by line" subtitle="On hand (available, reserved and held) × QuickBooks purchase cost">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-secondary">
                  <tr className="border-b border-line">
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 text-right font-medium">SKUs</th>
                    <th className="px-2 py-1.5 text-right font-medium">Cases on hand</th>
                    <th className="px-2 py-1.5 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {valueByLine.map((v) => (
                    <tr key={v.line} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5">{PRODUCT_LINE_LABELS[v.line]}</td>
                      <td className="px-2 py-1.5 text-right tabular">{v.skus}</td>
                      <td className="px-2 py-1.5 text-right tabular">{qty(Math.round(v.onHand))}</td>
                      <td className="px-2 py-1.5 text-right tabular">{money(v.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="On hand by SKU" subtitle={`${rows.length} SKUs${f.line ? ` · ${PRODUCT_LINE_LABELS[f.line]}` : ""} · fewest months of supply first · in ${unitLabel}`}>
            <div className="max-h-[36rem] overflow-auto">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <thead className="sticky top-0 bg-surface text-secondary">
                  <tr className="border-b border-line">
                    <th className="px-2 py-1.5 font-medium">SKU</th>
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 text-right font-medium">Available</th>
                    <th className="px-2 py-1.5 text-right font-medium">Reserved</th>
                    <th className="px-2 py-1.5 text-right font-medium">On open POs</th>
                    <th className="px-2 py-1.5 text-right font-medium">Usage / month</th>
                    <th className="px-2 py-1.5 text-right font-medium">Months on hand</th>
                    <th className="px-2 py-1.5 text-right font-medium">Unit cost</th>
                    <th className="px-2 py-1.5 text-right font-medium">Value</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {byMonths.map((r) => (
                    <tr key={r.sku} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{r.sku}</span>
                        {r.name && <span className="block text-xs text-muted">{r.name}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{PRODUCT_LINE_LABELS[r.line]}</td>
                      <td className="px-2 py-1.5 text-right tabular">{show(r, r.available)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{show(r, r.reserved)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{show(r, r.incoming)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{r.monthlyUsage > 0 ? show(r, r.monthlyUsage) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular">{months(r.monthsOnHand)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{r.unitCost === null ? "—" : money(r.unitCost)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{r.value === null ? "—" : money(r.value)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <details className="text-sm text-secondary">
            <summary className="cursor-pointer">How these numbers are worked out</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Stock comes from Orderwerks. <em>Available</em> is what can ship now; <em>reserved</em> is on the shelf but set aside for open orders;{" "}
                <em>on open POs</em> is ordered and not yet received. Cost is each item&apos;s purchase cost in QuickBooks.
              </p>
              <p>
                Monthly usage is the greater of your monthly usage table (admin page) and the average cases invoiced over the last 3 full months, net of
                credit memos. Months on hand = available ÷ monthly usage.
              </p>
              <p>
                A purchase order takes {LEAD_TIME_DAYS} days to arrive and stock should never fall below {FLOOR_MONTHS} months, so a SKU needs ordering when
                available plus open POs is under {REORDER_MONTHS.toFixed(1)} months of usage. The suggested order brings it back to that level; the order-by
                date is when it will get there at the current pace. &ldquo;Below 3 months&rdquo; means available stock alone is already under the floor.
              </p>
            </div>
          </details>
        </>
      )}
    </main>
  );
}
