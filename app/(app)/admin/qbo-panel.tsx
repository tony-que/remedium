"use client";

import { useActionState } from "react";
import { disconnectQboAction, testQboAction, type ActionResult } from "./actions";

export interface QboPanelProps {
  configured: boolean;
  appEnvironment: string | null;
  status: {
    connected: boolean;
    realmId?: string;
    companyName?: string | null;
    environment?: string;
    environmentMismatch?: boolean;
    connectedBy?: string;
    connectedAt?: string;
    refreshTokenExpiresAt?: string;
    lastRefreshedAt?: string | null;
    lastRefreshError?: string | null;
  };
  /** Result of a just-finished connect attempt, from ?qbo= */
  flash: { ok: boolean; message: string } | null;
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }) + " CT" : "—";

function Message({ state }: { state: ActionResult | { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
      {state.message}
    </p>
  );
}

const buttonClass = "rounded-md border border-current/30 px-3 py-1.5 text-sm font-medium hover:bg-current/5 disabled:opacity-50";

export function QboPanel({ configured, appEnvironment, status, flash }: QboPanelProps) {
  const [testState, testAction, testPending] = useActionState(async () => testQboAction(), null);
  const [discState, discAction, discPending] = useActionState(async () => disconnectQboAction(), null);

  if (!configured) {
    return (
      <p className="text-sm opacity-80">
        QuickBooks keys aren&apos;t set. Add <code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code>,{" "}
        <code>QBO_REDIRECT_URI</code> and <code>QBO_ENVIRONMENT</code> on the server (see README).
      </p>
    );
  }

  const daysLeft = status.refreshTokenExpiresAt
    ? Math.floor((new Date(status.refreshTokenExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <Message state={flash} />

      {!status.connected ? (
        <p className="text-sm">
          <strong>Not connected.</strong> Connect once with a QuickBooks admin login for the company file. Viewers never
          need QuickBooks access.
        </p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="opacity-70">Company</dt>
          <dd>{status.companyName ?? "(name not loaded yet)"}</dd>
          <dt className="opacity-70">Company id</dt>
          <dd className="break-all">{status.realmId}</dd>
          <dt className="opacity-70">Keys</dt>
          <dd className="capitalize">{status.environment}</dd>
          <dt className="opacity-70">Connected</dt>
          <dd>
            {fmt(status.connectedAt)} by {status.connectedBy}
          </dd>
          <dt className="opacity-70">Last refresh</dt>
          <dd>{fmt(status.lastRefreshedAt)}</dd>
          <dt className="opacity-70">Must reconnect by</dt>
          <dd>
            {fmt(status.refreshTokenExpiresAt)}
            {daysLeft !== null && daysLeft < 14 && (
              <span className="ml-2 text-amber-700 dark:text-amber-400">({daysLeft} days left; a sync extends it)</span>
            )}
          </dd>
        </dl>
      )}

      {status.environmentMismatch && (
        <p role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
          This connection was made with {status.environment} keys, but the app now uses {appEnvironment} keys.
          Reconnect QuickBooks.
        </p>
      )}
      {status.lastRefreshError && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          Last token refresh failed: {status.lastRefreshError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <a href="/api/qbo/connect" className={`${buttonClass} bg-foreground text-background hover:opacity-90`}>
          {status.connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
        </a>
        {status.connected && (
          <>
            <form action={testAction}>
              <button type="submit" disabled={testPending} className={buttonClass}>
                {testPending ? "Testing…" : "Test connection"}
              </button>
            </form>
            <form
              action={discAction}
              onSubmit={(e) => {
                if (!confirm("Disconnect QuickBooks? Syncing stops until an admin reconnects.")) e.preventDefault();
              }}
            >
              <button
                type="submit"
                disabled={discPending}
                className={`${buttonClass} border-red-600/40 text-red-700 hover:bg-red-600/10 dark:text-red-400`}
              >
                Disconnect
              </button>
            </form>
          </>
        )}
      </div>
      <Message state={testState ?? discState} />
    </div>
  );
}
