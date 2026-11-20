import { requireViewer } from "@/lib/access";
import { filtersToQuery, parseFilters, todayCentral } from "@/lib/metrics/filters";
import { getDashboard } from "@/lib/metrics/dashboard";
import { measureOf } from "@/lib/metrics/queries";
import { DashboardNav } from "@/components/dashboard/nav";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { TotalsCards } from "@/components/dashboard/totals-cards";
import { MonthChart, TopBars, type TopBarRow } from "@/components/dashboard/charts";
import { CustomerTable, SkuTable } from "@/components/dashboard/tables";
import { HeatGrid } from "@/components/dashboard/heat-grid";
import { MEASURE_LABEL } from "@/components/format";

export const dynamic = "force-dynamic";

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 ${className}`}>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-secondary">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function asOfText(iso: string | null) {
  if (!iso) return "No data synced yet";
  const d = new Date(iso);
  return `Data as of ${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })} CT`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireViewer();
  const today = todayCentral();
  const f = parseFilters(await searchParams, today);
  const d = await getDashboard(f);
  const q = filtersToQuery(f);
  const exportHref = (kind: string) => `/api/export/${kind}?${q}`;

  const top = (rows: TopBarRow[]) => [...rows].sort((a, b) => measureOf(b, f.measure) - measureOf(a, f.measure)).slice(0, 12);
  const topSkus = top(d.skus.rows.map((r) => ({ key: r.sku, label: r.sku, sales: r.sales, units: r.units, eaches: r.eaches })));
  const topCustomers = top(d.customers.map((r) => ({ key: r.customerId, label: r.customer, sales: r.sales, units: r.units, eaches: r.eaches })));
  const m = MEASURE_LABEL[f.measure];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold">Sales by SKU and customer</h1>
          <p className="text-sm text-muted">{asOfText(d.asOf)}</p>
        </div>
        <p className="text-secondary">{d.headline}</p>
      </header>

      {d.missing.length > 0 && (
        <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>
          <strong>No eaches conversion</strong> for {d.missing.map((x) => x.sku).join(", ")}. These count as 0 eaches. An admin can add
          them on the admin page.
        </div>
      )}

      <DashboardNav filters={f}>
        <div className="flex flex-col gap-5">
          <FiltersBar today={today} customerLabel={d.customerLabel} />
          <TotalsCards totals={d.totals} />

          <Card title={`${m} by month`} subtitle="Hover a month for dollars and cases">
            <MonthChart rows={d.months} measure={f.measure} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={`Top SKUs by ${m}`} subtitle={f.customer ? "For the selected customer · product items only" : "Product items only · click a bar to filter"}>
              <TopBars rows={topSkus} measure={f.measure} kind="sku" />
            </Card>
            <Card title={`Top customers by ${m}`} subtitle={f.sku ? `Buying ${f.sku}` : "All items · click a bar to filter"}>
              <TopBars rows={topCustomers} measure={f.measure} kind="customer" />
            </Card>
          </div>

          <Card title="Every SKU" subtitle={`${d.skus.rows.length} SKU${d.skus.rows.length === 1 ? "" : "s"} · product items only${f.customer ? " · selected customer" : ""}`}>
            <SkuTable rows={d.skus.rows} nonProductSales={d.skus.nonProductSales} exportHref={exportHref("skus")} />
          </Card>

          <Card title="Every customer" subtitle={`${d.customers.length} customer${d.customers.length === 1 ? "" : "s"}${f.sku ? ` · buying ${f.sku}` : ""}`}>
            <CustomerTable rows={d.customers} exportHref={exportHref("customers")} />
          </Card>

          <Card title={`SKU × customer · ${m}`} subtitle="Top 10 SKUs in the selection · darker is more">
            <HeatGrid grid={d.grid} measure={f.measure} exportHref={exportHref("grid")} />
          </Card>

          <p className="text-right text-sm">
            <a href={exportHref("lines")} className="underline underline-offset-2">
              Download every line behind these totals (CSV)
            </a>
          </p>
        </div>
      </DashboardNav>
    </main>
  );
}
