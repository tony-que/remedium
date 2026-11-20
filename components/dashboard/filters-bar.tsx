"use client";

import { activePreset, INTERVALS, MEASURES, PRESET_LABELS, presetRange, type Preset } from "@/lib/metrics/filters";
import { MEASURE_LABEL } from "@/components/format";
import { useNav } from "./nav";

const PRESETS: Preset[] = ["ytd", "last90", "lastYear", "samePeriodLastYear"];

const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm";
const segBase = "px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md border border-line -ml-px first:ml-0";

/** The one row of controls above everything they scope. */
export function FiltersBar({ today, customerLabel }: { today: string; customerLabel: string | null }) {
  const { filters: f, update } = useNav();
  const active = activePreset(f, today);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-secondary">
            From
            <input
              type="date"
              value={f.from}
              max={f.to}
              onChange={(e) => e.target.value && e.target.value <= f.to && update({ from: e.target.value })}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-secondary">
            To
            <input
              type="date"
              value={f.to}
              min={f.from}
              onChange={(e) => e.target.value && e.target.value >= f.from && update({ to: e.target.value })}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>

        <div role="group" aria-label="Date presets" className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const on = p === active;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => update(presetRange(p, f, today))}
                className={`rounded-md px-2.5 py-1.5 text-sm ${on ? "bg-foreground font-semibold text-background" : "border border-line bg-surface hover:bg-foreground/5"}`}
              >
                {PRESET_LABELS[p]}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label="Measure" className="flex">
          {MEASURES.map((m) => {
            const on = f.measure === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => update({ measure: m })}
                className={`${segBase} ${on ? "z-10 border-foreground bg-foreground text-background" : "bg-surface hover:bg-foreground/5"}`}
              >
                {MEASURE_LABEL[m]}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label="Chart by month or week" className="flex">
          {INTERVALS.map((i) => {
            const on = f.interval === i;
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => update({ interval: i })}
                className={`${segBase} ${on ? "z-10 border-foreground bg-foreground text-background" : "bg-surface hover:bg-foreground/5"}`}
              >
                {i === "month" ? "By month" : "By week"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={f.excludeZero} onChange={(e) => update({ excludeZero: e.target.checked })} className="size-4 accent-[var(--series-1)]" />
          Exclude $0 lines <span className="text-muted">(samples, replacements)</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.amazonSeparate}
            // A SKU filter means a different thing once variants split or merge, so clear it.
            onChange={(e) => update({ amazonSeparate: e.target.checked, sku: null })}
            className="size-4 accent-[var(--series-1)]"
          />
          Show Amazon variants separately
        </label>
        {f.customer && (
          <span className={chipClass}>
            <span className="text-muted">Customer</span> {customerLabel ?? f.customer}
            <button type="button" onClick={() => update({ customer: null })} aria-label="Clear customer filter" className="-mr-1 rounded-full px-1 text-secondary hover:text-foreground">
              ✕
            </button>
          </span>
        )}
        {f.sku && (
          <span className={chipClass}>
            <span className="text-muted">SKU</span> {f.sku}
            <button type="button" onClick={() => update({ sku: null })} aria-label="Clear SKU filter" className="-mr-1 rounded-full px-1 text-secondary hover:text-foreground">
              ✕
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
