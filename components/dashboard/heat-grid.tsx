"use client";

import type { Grid } from "@/lib/metrics/queries";
import { compactMeasure, formatMeasure, MEASURE_LABEL, type MeasureKey } from "@/components/format";
import { useNav } from "./nav";

// Customers × top SKUs. Every cell prints its value; the one-hue blue shade
// (five steps, light → dark) only reinforces it. Empty cells stay blank.

function step(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((v / max) * 5)));
}

export function HeatGrid({ grid, measure, exportHref }: { grid: Grid; measure: MeasureKey; exportHref: string }) {
  const nav = useNav();
  if (grid.skus.length === 0) return <p className="py-10 text-center text-sm text-muted">No product sales in this selection.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-line">
        <table className="border-collapse text-sm">
          <caption className="sr-only">
            {MEASURE_LABEL[measure]} by customer and SKU. Click a customer or SKU to filter the page.
          </caption>
          <thead className="sticky top-0 z-20 bg-surface">
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-30 bg-surface px-3 py-2 text-left font-medium text-secondary">
                Customer
              </th>
              {grid.skus.map((s) => (
                <th key={s} scope="col" className="px-1 py-2 text-right font-medium whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => nav.toggleSku(s)}
                    aria-pressed={nav.filters.sku === s}
                    className={`rounded px-2 py-0.5 hover:bg-foreground/5 ${nav.filters.sku === s ? "font-semibold text-foreground underline" : "text-secondary"}`}
                  >
                    {s}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.customerId}>
                <th scope="row" className="sticky left-0 z-10 max-w-[14rem] bg-surface px-3 py-1 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => nav.toggleCustomer(r.customerId)}
                    aria-pressed={nav.filters.customer === r.customerId}
                    className={`truncate text-left hover:underline ${nav.filters.customer === r.customerId ? "font-semibold" : ""}`}
                    title={r.customer}
                  >
                    {r.customer}
                  </button>
                </th>
                {grid.skus.map((s) => {
                  const v = r.cells[s] ?? 0;
                  const k = step(v, grid.max);
                  return (
                    <td key={s} className="p-0.5">
                      <div
                        title={`${r.customer} · ${s}: ${formatMeasure(measure, v)}`}
                        className="tabular min-w-[4.5rem] rounded px-2 py-1 text-right whitespace-nowrap"
                        style={k ? { background: `var(--heat-${k})`, color: `var(--heat-ink-${k})` } : undefined}
                      >
                        {v === 0 ? "" : compactMeasure(measure, v)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end text-xs text-muted">
        <a href={exportHref} className="underline underline-offset-2 hover:text-foreground">
          Download CSV
        </a>
      </div>
    </div>
  );
}
