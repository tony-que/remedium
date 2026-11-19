"use client";

import { useActionState } from "react";
import { syncNowAction } from "./actions";

export interface SyncRunRow {
  id: string;
  kind: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  invoicesUpserted: number;
  invoicesDeleted: number;
  apiRequests: number;
  note: string | null;
  error: string | null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

function seconds(a: string, b: string | null) {
  if (!b) return "—";
  const s = (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`;
}

const STATUS_CLASS: Record<string, string> = {
  succeeded: "text-green-700 dark:text-green-400",
  failed: "text-red-700 dark:text-red-400",
  running: "text-amber-700 dark:text-amber-400",
};

const buttonClass = "rounded-md border border-current/30 px-3 py-1.5 text-sm font-medium hover:bg-current/5 disabled:opacity-50";

export function SyncPanel({ runs, connected }: { runs: SyncRunRow[]; connected: boolean }) {
  const [state, action, pending] = useActionState(syncNowAction, null);

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <button type="submit" name="mode" value="auto" disabled={pending || !connected} className={`${buttonClass} bg-foreground text-background hover:opacity-90`}>
          {pending ? "Syncing…" : "Refresh now"}
        </button>
        <button
          type="submit"
          name="mode"
          value="full"
          disabled={pending || !connected}
          className={buttonClass}
          title="Re-reads everything since the start date and drops anything deleted in QuickBooks"
        >
          Full re-read
        </button>
        {!connected && <span className="text-sm opacity-70">Connect QuickBooks first.</span>}
      </form>
      {state && (
        <p role="status" className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
          {state.message}
        </p>
      )}

      <h3 className="mt-2 text-sm font-semibold">Last 20 runs (Central time)</h3>
      {runs.length === 0 ? (
        <p className="text-sm opacity-70">No syncs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="opacity-70">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Started</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Kind</th>
                <th className="py-1.5 pr-3 font-medium">By</th>
                <th className="py-1.5 pr-3 text-right font-medium">Docs</th>
                <th className="py-1.5 pr-3 text-right font-medium">Deleted</th>
                <th className="py-1.5 pr-3 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-current/10 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(r.startedAt)}</td>
                  <td className={`py-1.5 pr-3 capitalize ${STATUS_CLASS[r.status] ?? ""}`}>{r.status}</td>
                  <td className="py-1.5 pr-3">{r.kind}</td>
                  <td className="py-1.5 pr-3 break-all">{r.triggeredBy}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.invoicesUpserted}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.invoicesDeleted}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{seconds(r.startedAt, r.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.some((r) => r.error || r.note) && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer opacity-80">Notes and errors</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {runs
                  .filter((r) => r.error || r.note)
                  .map((r) => (
                    <li key={r.id}>
                      <span className="opacity-70">{fmt(r.startedAt)}:</span> {r.note}
                      {r.error && <span className="text-red-700 dark:text-red-400"> {r.error}</span>}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
