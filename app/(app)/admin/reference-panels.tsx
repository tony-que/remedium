"use client";

import { useActionState, useMemo, useState } from "react";
import { deleteConversionAction, setConversionAction, setItemProductAction, type ActionResult } from "./actions";

function Status({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-[var(--delta-good)]" : "text-[var(--delta-bad)]"}`}>
      {state.message}
    </p>
  );
}

const input = "rounded-md border border-line bg-transparent px-2 py-1 text-sm";
const btn = "rounded-md border border-current/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50";

export interface ItemRow {
  qboId: string;
  sku: string;
  category: string | null;
  itemType: string | null;
  active: boolean;
  isProduct: boolean;
  setByAdmin: boolean;
}

/** Which items count as products (and so appear in the SKU views). */
export function ItemsPanel({ items }: { items: ItemRow[] }) {
  const [state, action, pending] = useActionState(setItemProductAction, null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (showInactive || i.active) && (!s || `${i.sku} ${i.category ?? ""}`.toLowerCase().includes(s)));
  }, [items, q, showInactive]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder="Filter by SKU or category" value={q} onChange={(e) => setQ(e.target.value)} className={`${input} w-64 max-w-full`} aria-label="Filter items" />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4" /> Show inactive
        </label>
        <span className="text-sm text-muted">{shown.length} of {items.length}</span>
      </div>
      <Status state={state} />
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="sticky top-0 bg-surface text-secondary">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 font-medium">SKU</th>
              <th className="px-3 py-1.5 font-medium">Category</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Product?</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.qboId} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">
                  {i.sku}
                  {!i.active && <span className="ml-2 text-xs text-muted">inactive</span>}
                </td>
                <td className="px-3 py-1.5 text-secondary">{i.category ?? <span className="text-muted">none</span>}</td>
                <td className="px-3 py-1.5 text-secondary">{i.itemType}</td>
                <td className="px-3 py-1.5">
                  <form action={action} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="qboId" value={i.qboId} />
                    <button
                      type="submit"
                      name="value"
                      value={i.isProduct ? "false" : "true"}
                      disabled={pending}
                      role="switch"
                      aria-checked={i.isProduct}
                      aria-label={`${i.sku} counts as a product`}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${i.isProduct ? "bg-[var(--series-1)] text-white" : "border border-line text-secondary"}`}
                    >
                      {i.isProduct ? "Yes" : "No"}
                    </button>
                    {i.setByAdmin ? (
                      <button type="submit" name="value" value="auto" disabled={pending} className="text-xs text-muted underline">
                        set by hand · reset
                      </button>
                    ) : (
                      <span className="text-xs text-muted">automatic</span>
                    )}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ConversionRow {
  sku: string;
  eachesPerUnit: number;
  note: string | null;
  updatedBy: string;
  updatedAt: string;
}

function ConversionLine({ c, onResult }: { c: ConversionRow; onResult: (s: ActionResult | null) => void }) {
  const [saveState, save, saving] = useActionState(async (p: ActionResult | null, fd: FormData) => {
    const r = await setConversionAction(p, fd);
    onResult(r);
    return r;
  }, null);
  const [, remove, removing] = useActionState(async (p: ActionResult | null, fd: FormData) => {
    const r = await deleteConversionAction(p, fd);
    onResult(r);
    return r;
  }, null);
  const unconfirmed = c.note && /please fill in/i.test(c.note);
  return (
    <tr className="border-b border-line last:border-0 align-top">
      <td className="px-3 py-1.5 whitespace-nowrap">{c.sku}</td>
      <td className="px-3 py-1.5">
        <form action={save} className="flex items-center gap-2">
          <input type="hidden" name="sku" value={c.sku} />
          <input name="eachesPerUnit" defaultValue={c.eachesPerUnit} inputMode="numeric" aria-label={`Eaches per unit for ${c.sku}`} className={`${input} w-24 text-right tabular`} />
          <button type="submit" disabled={saving} className={btn}>Save</button>
        </form>
        {saveState && !saveState.ok && <p className="mt-1 text-xs text-[var(--delta-bad)]">{saveState.message}</p>}
      </td>
      <td className="px-3 py-1.5 text-xs">
        {unconfirmed ? <span className="text-[var(--delta-bad)]">⚠ unconfirmed: {c.note}</span> : <span className="text-muted">{c.note}</span>}
      </td>
      <td className="hidden px-3 py-1.5 text-xs text-muted md:table-cell">
        {c.updatedBy} · {new Date(c.updatedAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}
      </td>
      <td className="px-3 py-1.5">
        <form
          action={remove}
          onSubmit={(e) => {
            if (!confirm(`Remove the conversion for ${c.sku}? It will count as 0 eaches.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="sku" value={c.sku} />
          <button type="submit" disabled={removing} className="text-xs text-[var(--delta-bad)] underline">Remove</button>
        </form>
      </td>
    </tr>
  );
}

/** Eaches per unit, by each item's own SKU. */
export function ConversionsPanel({ conversions, missing }: { conversions: ConversionRow[]; missing: string[] }) {
  const [last, setLast] = useState<ActionResult | null>(null);
  const [addState, add, adding] = useActionState(setConversionAction, null);
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const unconfirmedCount = conversions.filter((c) => c.note && /please fill in/i.test(c.note)).length;
  const shown = onlyUnconfirmed ? conversions.filter((c) => c.note && /please fill in/i.test(c.note)) : conversions;

  return (
    <div className="flex flex-col gap-3">
      {missing.length > 0 && (
        <p className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>Product SKUs with no conversion (counted as 0 eaches): {missing.join(", ")}
        </p>
      )}
      <form action={add} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          SKU
          <input name="sku" list="missing-skus" required className={`${input} w-56`} placeholder="Exactly as in QuickBooks" />
          <datalist id="missing-skus">{missing.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Eaches per unit
          <input name="eachesPerUnit" required inputMode="numeric" className={`${input} w-28 text-right`} />
        </label>
        <button type="submit" disabled={adding} className={btn}>Add or update</button>
      </form>
      <Status state={addState ?? last} />
      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyUnconfirmed} onChange={(e) => setOnlyUnconfirmed(e.target.checked)} className="size-4" />
          Only unconfirmed ({unconfirmedCount})
        </label>
        <span className="text-muted">{conversions.length} SKUs</span>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="sticky top-0 bg-surface text-secondary">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 font-medium">SKU</th>
              <th className="px-3 py-1.5 font-medium">Eaches per unit</th>
              <th className="px-3 py-1.5 font-medium">Note</th>
              <th className="hidden px-3 py-1.5 font-medium md:table-cell">Updated</th>
              <th className="px-3 py-1.5"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => <ConversionLine key={`${c.sku}-${c.eachesPerUnit}-${c.updatedAt}`} c={c} onResult={setLast} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
