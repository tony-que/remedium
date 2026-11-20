"use client";

import { useMemo, useState } from "react";
import type { CustomerRow, SkuRow } from "@/lib/metrics/queries";
import { money, pct, qty } from "@/components/format";
import { useNav } from "./nav";

// Sortable, clickable tables. These are also the "table view" for the charts:
// every number a chart shows is here without hovering.

interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  sortValue: (r: T) => number | string | null;
  render: (r: T) => React.ReactNode;
  className?: string;
}

function SortableTable<T>({
  rows,
  columns,
  rowKey,
  selectedKey,
  onSelect,
  initialSort,
  caption,
  sticky = false,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  initialSort: string;
  caption: string;
  sticky?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initialSort, desc: true });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    return [...rows].sort((a, b) => {
      const va = col.sortValue(a);
      const vb = col.sortValue(b);
      if (va === vb) return 0;
      if (va === null) return 1; // blanks last, either direction
      if (vb === null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, columns, sort]);

  const first = columns[0];
  return (
    <div className={`overflow-auto rounded-lg border border-line ${sticky ? "max-h-[32rem]" : ""}`}>
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}. Click a row to filter the page.</caption>
        <thead className={`bg-surface ${sticky ? "sticky top-0 z-10" : ""}`}>
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                  className={`px-3 py-2 font-medium text-secondary ${c.numeric ? "text-right" : ""} ${c.className ?? ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !!c.numeric }))}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {c.label}
                    <span aria-hidden className={active ? "" : "opacity-0"}>
                      {sort.desc ? "↓" : "↑"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const key = rowKey(r);
            const on = selectedKey === key;
            return (
              <tr
                key={key}
                onClick={() => onSelect(key)}
                className={`cursor-pointer border-b border-line last:border-0 ${on ? "bg-[var(--series-1)]/10" : "hover:bg-foreground/[0.03]"}`}
              >
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-1.5 align-top ${c.numeric ? "tabular text-right whitespace-nowrap" : ""} ${c.className ?? ""}`}>
                    {i === 0 ? (
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(key);
                        }}
                        className="text-left font-medium hover:underline"
                      >
                        {first.render(r)}
                      </button>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SkuTable({ rows, nonProductSales, exportHref }: { rows: SkuRow[]; nonProductSales: number; exportHref: string }) {
  const nav = useNav();
  const columns: Column<SkuRow>[] = useMemo(
    () => [
      { key: "sku", label: "SKU", sortValue: (r) => r.sku, render: (r) => (
        <>
          {r.sku}
          {r.mixesPacks && <span title="Mixes cases and packs: Amazon pack variants count packs, not cases" className="ml-1 text-muted">†</span>}
        </>
      ) },
      { key: "category", label: "Category", sortValue: (r) => r.category, render: (r) => <span className="text-secondary">{r.category}</span>, className: "max-w-[14rem]" },
      { key: "description", label: "Description", sortValue: (r) => r.description, render: (r) => <span className="line-clamp-2 text-secondary">{r.description}</span>, className: "max-w-[18rem]" },
      { key: "units", label: "Cases", numeric: true, sortValue: (r) => r.units, render: (r) => qty(r.units) },
      { key: "epu", label: "Eaches / case", numeric: true, sortValue: (r) => r.eachesPerUnit, render: (r) =>
        r.missingConversion ? <span className="text-[var(--delta-bad)]" title="No conversion: counts as 0 eaches">none</span>
        : r.mixedConversion ? <span className="text-muted" title="Variants with different conversions">mixed</span>
        : qty(r.eachesPerUnit ?? 0) },
      { key: "eaches", label: "Eaches", numeric: true, sortValue: (r) => r.eaches, render: (r) => qty(r.eaches) },
      { key: "sales", label: "Sales $", numeric: true, sortValue: (r) => r.sales, render: (r) => money(r.sales) },
      { key: "avg", label: "Avg price", numeric: true, sortValue: (r) => r.avgPrice, render: (r) => (r.avgPrice === null ? "" : money(r.avgPrice)) },
      { key: "pct", label: "% of $", numeric: true, sortValue: (r) => r.pctOfSales, render: (r) => pct(r.pctOfSales) },
    ],
    [],
  );
  const anyPacks = rows.some((r) => r.mixesPacks);
  return (
    <div className="flex flex-col gap-2">
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.sku}
        selectedKey={nav.filters.sku}
        onSelect={nav.toggleSku}
        initialSort="sales"
        caption="Every SKU"
        sticky
      />
      <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-muted">
        <div className="flex flex-col gap-0.5">
          {nonProductSales !== 0 && <p>{money(nonProductSales)} in non-product items not shown.</p>}
          {anyPacks && <p>† Amazon pack variants count packs, not cases, so the Cases figure for these SKUs mixes the two.</p>}
        </div>
        <a href={exportHref} className="underline underline-offset-2 hover:text-foreground">
          Download CSV
        </a>
      </div>
    </div>
  );
}

export function CustomerTable({ rows, exportHref }: { rows: CustomerRow[]; exportHref: string }) {
  const nav = useNav();
  const columns: Column<CustomerRow>[] = useMemo(
    () => [
      { key: "customer", label: "Customer", sortValue: (r) => r.customer, render: (r) => r.customer, className: "max-w-[18rem]" },
      { key: "units", label: "Cases", numeric: true, sortValue: (r) => r.units, render: (r) => qty(r.units) },
      { key: "eaches", label: "Eaches", numeric: true, sortValue: (r) => r.eaches, render: (r) => qty(r.eaches) },
      { key: "sales", label: "Sales $", numeric: true, sortValue: (r) => r.sales, render: (r) => money(r.sales) },
      { key: "invoices", label: "Invoices", numeric: true, sortValue: (r) => r.invoices, render: (r) => qty(r.invoices) },
      { key: "skus", label: "SKUs bought", numeric: true, sortValue: (r) => r.skusBought, render: (r) => qty(r.skusBought) },
      { key: "pct", label: "% of $", numeric: true, sortValue: (r) => r.pctOfSales, render: (r) => pct(r.pctOfSales) },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-2">
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.customerId}
        selectedKey={nav.filters.customer}
        onSelect={nav.toggleCustomer}
        initialSort="sales"
        caption="Every customer"
        sticky
      />
      <div className="flex justify-end text-xs text-muted">
        <a href={exportHref} className="underline underline-offset-2 hover:text-foreground">
          Download CSV
        </a>
      </div>
    </div>
  );
}
