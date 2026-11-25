"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactMoney, dayLabel, money, monthLabel } from "@/components/format";
import type { ArTrendPoint } from "@/lib/ar/queries";

// AR at each month end and today: past due (blue) stacked under the rest of
// the net balance (light blue). Hairline grid, 24px max bars, as on Sales.

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 12 };

export function ArTrendChart({ points, today }: { points: ArTrendPoint[]; today: string }) {
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted">No receivables history yet.</p>;
  const data = points.map((p) => ({ ...p, notPastDue: Math.max(0, p.net - p.pastDue), pastDueShown: Math.min(p.pastDue, Math.max(0, p.net)) }));
  const multiYear = new Set(points.map((p) => p.asOf.slice(0, 4))).size > 1;
  const tick = (d: string) => (d === today ? "Today" : monthLabel(`${d.slice(0, 7)}-01`, multiYear));
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-1)]" /> Past due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-1-muted)]" /> Not yet due (net of credits)
        </span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="10%">
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis dataKey="asOf" tickFormatter={tick} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickFormatter={(n: number) => compactMoney(n)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload ? (payload[0].payload as ArTrendPoint) : null;
                if (!p) return null;
                const pct = p.net > 0 ? ` (${Math.round((p.pastDue / p.net) * 100)}%)` : "";
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-md">
                    <p className="font-semibold">{money(p.net)} net AR</p>
                    <p className="tabular text-secondary">
                      {money(p.pastDue)} past due{pct}
                    </p>
                    <p className="text-xs text-muted">{p.asOf === today ? `Today, ${dayLabel(p.asOf, true)}` : `As of ${dayLabel(p.asOf, true)}`}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="pastDueShown" stackId="ar" name="Past due" fill="var(--series-1)" maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="notPastDue" stackId="ar" name="Not yet due" fill="var(--series-1-muted)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
