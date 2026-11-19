import type { TotalsWithChange } from "@/lib/metrics/queries";
import { compactMoney, compactQty, money, qty } from "@/components/format";

// Five stat tiles: value, then the change vs the same dates last year. Up is
// good for all five; the color always comes with an arrow and a sign.

const CARDS = [
  { key: "sales", label: "Sales $", short: compactMoney, full: money },
  { key: "units", label: "Units sold", short: compactQty, full: qty },
  { key: "eaches", label: "Eaches sold", short: compactQty, full: qty },
  { key: "invoices", label: "Invoices", short: compactQty, full: qty },
  { key: "customers", label: "Customers", short: compactQty, full: qty },
] as const;

function Delta({ change, prior, full }: { change: number | null; prior: number; full: (n: number) => string }) {
  if (change === null) return <p className="text-xs text-muted">No sales the same dates last year</p>;
  const up = change > 0;
  const flat = Math.abs(change) < 0.0005;
  const color = flat ? "text-secondary" : up ? "text-[var(--delta-good)]" : "text-[var(--delta-bad)]";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  const sign = up ? "+" : "";
  return (
    <p className="text-xs">
      <span className={`font-semibold ${color}`}>
        <span aria-hidden>{arrow} </span>
        {sign}
        {(change * 100).toFixed(1)}%
      </span>{" "}
      <span className="text-muted">vs {full(prior)} last year</span>
    </p>
  );
}

export function TotalsCards({ totals }: { totals: TotalsWithChange }) {
  return (
    <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((c) => (
        <div key={c.key} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 last:col-span-2 sm:last:col-span-1">
          <p className="text-sm text-secondary">{c.label}</p>
          <p className="text-2xl font-semibold" title={c.full(totals.current[c.key])}>
            {c.short(totals.current[c.key])}
          </p>
          <Delta change={totals.change[c.key]} prior={totals.prior[c.key]} full={c.full} />
        </div>
      ))}
    </section>
  );
}
