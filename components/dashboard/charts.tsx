"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthRow } from "@/lib/metrics/queries";
import { compactMeasure, formatMeasure, MEASURE_LABEL, money, monthLabel, qty, type MeasureKey } from "@/components/format";
import { useNav } from "./nav";

// Single-series bar charts: one blue, no legend (the card title names the
// measure), hairline grid, 24px max bar, 4px rounded data end. Tooltips lead
// with the value; the tables below carry every number without hovering.

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 12 };

function TooltipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-md">{children}</div>;
}

export function MonthChart({ rows, measure }: { rows: MonthRow[]; measure: MeasureKey }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted">No sales in this range.</p>;
  const multiYear = new Set(rows.map((r) => r.month.slice(0, 4))).size > 1;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m, multiYear)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--axis)" }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            tickFormatter={(n: number) => compactMeasure(measure, n)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }}
            content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload ? (payload[0].payload as MonthRow) : null;
              if (!r) return null;
              return (
                <TooltipBox>
                  <p className="font-semibold">{money(r.sales)}</p>
                  <p className="tabular text-secondary">
                    {qty(r.units)} cases · {qty(r.eaches)} eaches
                  </p>
                  <p className="text-xs text-muted">{monthLabel(r.month)}</p>
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey={measure} name={MEASURE_LABEL[measure]} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TopBarRow {
  key: string;
  label: string;
  sales: number;
  units: number;
  eaches: number;
}

const ROW_PX = 30;

/** Horizontal bars of the top rows. Clicking a bar filters the page; clicking it again clears it. */
export function TopBars({ rows, measure, kind }: { rows: TopBarRow[]; measure: MeasureKey; kind: "sku" | "customer" }) {
  const nav = useNav();
  const selected = kind === "sku" ? nav.filters.sku : nav.filters.customer;
  const toggle = (key: string) => (kind === "sku" ? nav.toggleSku(key) : nav.toggleCustomer(key));
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted">Nothing to show.</p>;
  const truncate = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

  return (
    <div style={{ height: rows.length * ROW_PX + 8 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="key"
            tickFormatter={(k: string) => truncate(rows.find((r) => r.key === k)?.label ?? k)}
            tick={{ ...AXIS_TICK, fill: "var(--text-secondary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--axis)" }}
            width={120}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }}
            content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload ? (payload[0].payload as TopBarRow) : null;
              if (!r) return null;
              return (
                <TooltipBox>
                  <p className="font-semibold">{formatMeasure(measure, measureValue(r, measure))}</p>
                  <p className="tabular text-secondary">
                    {money(r.sales)} · {qty(r.units)} cases · {qty(r.eaches)} eaches
                  </p>
                  <p className="text-xs text-muted">{r.label}</p>
                  <p className="mt-1 text-xs text-muted">{selected === r.key ? "Click to clear the filter" : "Click to filter the page"}</p>
                </TooltipBox>
              );
            }}
          />
          <Bar
            dataKey={measure}
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(d) => toggle((d as unknown as { payload: TopBarRow }).payload.key)}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={!selected || selected === r.key ? "var(--series-1)" : "var(--series-1-muted)"} />
            ))}
            <LabelList
              dataKey={measure}
              position="right"
              formatter={(v: unknown) => compactMeasure(measure, Number(v))}
              style={{ fill: "var(--text-secondary)", fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function measureValue(r: TopBarRow, m: MeasureKey) {
  return m === "sales" ? r.sales : m === "units" ? r.units : r.eaches;
}
