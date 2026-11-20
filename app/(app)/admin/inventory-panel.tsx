"use client";

import { useActionState } from "react";
import { syncInventoryAction, uploadUsageAction, type ActionResult } from "./actions";

export interface InventoryRunRow {
  id: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  skus: number;
  note: string | null;
  error: string | null;
}

export interface UsageRowView {
  sku: string;
  monthlyUnits: number;
  updatedBy: string;
  updatedAt: string;
}

function Status({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-[var(--delta-good)]" : "text-[var(--delta-bad)]"}`}>
      {state.message}
    </p>
  );
}

const btn = "rounded-md border border-current/30 px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

/** Recent inventory syncs and Refresh inventory. */
export function InventorySyncPanel({ configured, runs }: { configured: boolean; runs: InventoryRunRow[] }) {
  const [state, action, pending] = useActionState(async () => syncInventoryAction(), null);
  return (
    <div className="flex flex-col gap-3">
      {!configured && (
        <p className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          <span aria-hidden>⚠ </span>Connect QuickBooks above first: stock levels come from QuickBooks quantity on hand.
        </p>
      )}
      <form action={action}>
        <button type="submit" disabled={pending || !configured} className={btn}>
          {pending ? "Refreshing…" : "Refresh inventory now"}
        </button>
      </form>
      <Status state={state} />
      {runs.length > 0 && (
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-surface text-secondary">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 font-medium">Started</th>
                <th className="px-3 py-1.5 font-medium">By</th>
                <th className="px-3 py-1.5 font-medium">Result</th>
                <th className="px-3 py-1.5 text-right font-medium">SKUs</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5">{when(r.startedAt)}</td>
                  <td className="px-3 py-1.5 text-muted">{r.triggeredBy}</td>
                  <td className="px-3 py-1.5">
                    <span className={r.status === "failed" ? "text-[var(--delta-bad)]" : r.status === "succeeded" ? "text-[var(--delta-good)]" : ""}>{r.status}</span>
                    {(r.error || r.note) && <p className="text-xs text-muted">{r.error ?? r.note}</p>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{r.status === "succeeded" ? r.skus : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Upload the owner's monthly usage table, and show what's loaded. */
export function UsagePanel({ usage }: { usage: UsageRowView[] }) {
  const [state, action, pending] = useActionState(uploadUsageAction, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" aria-label="Monthly usage CSV" />
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "Uploading…" : "Upload and replace"}
        </button>
      </form>
      <Status state={state} />
      {usage.length === 0 ? (
        <p className="text-sm text-muted">No monthly usage uploaded yet. Months of supply uses the last 3 months&apos; sales until you add some.</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-secondary">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 font-medium">SKU</th>
                <th className="px-3 py-1.5 text-right font-medium">Cases per month</th>
                <th className="hidden px-3 py-1.5 font-medium md:table-cell">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.sku} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">{u.sku}</td>
                  <td className="px-3 py-1.5 text-right tabular">{u.monthlyUnits.toLocaleString("en-US")}</td>
                  <td className="hidden px-3 py-1.5 text-xs text-muted md:table-cell">
                    {u.updatedBy} · {new Date(u.updatedAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
