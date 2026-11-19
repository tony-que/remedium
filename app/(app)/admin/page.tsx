import { requireAdmin } from "@/lib/access";
import { listAllowedUsers } from "@/lib/allowlist";
import { getQboConfig, qboConfigured } from "@/lib/qbo/config";
import { connectionStatus } from "@/lib/qbo/connection";
import { AllowList } from "./allow-list";
import { QboPanel } from "./qbo-panel";
import { SyncPanel } from "./sync-panel";
import { prisma } from "@/lib/db";

const QBO_FLASH: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "QuickBooks connected." },
  denied: { ok: false, message: "The connection was cancelled in QuickBooks." },
  state_mismatch: { ok: false, message: "That connection link expired or came from another browser. Try Connect again." },
  not_configured: { ok: false, message: "QuickBooks keys aren't set on the server." },
  error: { ok: false, message: "QuickBooks didn't accept the connection. Try again; details are in the server log." },
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ qbo?: string }> }) {
  const { email } = await requireAdmin();
  const { qbo } = await searchParams;
  const configured = qboConfigured();
  const config = configured ? getQboConfig() : null;
  const [users, status, runs] = await Promise.all([
    listAllowedUsers(),
    connectionStatus(config),
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  const iso = (d?: Date | null) => (d ? d.toISOString() : undefined);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section aria-labelledby="qbo-heading" className="flex flex-col gap-2">
        <h2 id="qbo-heading" className="text-lg font-semibold">
          QuickBooks
        </h2>
        <QboPanel
          configured={configured}
          appEnvironment={config?.environment ?? null}
          flash={qbo ? (QBO_FLASH[qbo] ?? null) : null}
          status={{
            connected: status.connected,
            realmId: status.realmId,
            companyName: status.companyName,
            environment: status.environment,
            environmentMismatch: status.environmentMismatch,
            connectedBy: status.connectedBy,
            connectedAt: iso(status.connectedAt),
            refreshTokenExpiresAt: iso(status.refreshTokenExpiresAt),
            lastRefreshedAt: iso(status.lastRefreshedAt) ?? null,
            lastRefreshError: status.lastRefreshError,
          }}
        />
      </section>

      <section aria-labelledby="sync-heading" className="flex flex-col gap-2">
        <h2 id="sync-heading" className="text-lg font-semibold">
          Sync
        </h2>
        <p className="text-sm opacity-70">
          Runs every night at 2 a.m. Central (3 a.m. during daylight time). Refresh now picks up changes since the last
          run; Full re-read reloads everything and drops anything deleted in QuickBooks.
        </p>
        <SyncPanel
          connected={status.connected && !status.environmentMismatch}
          runs={runs.map((r) => ({
            id: r.id.toString(),
            kind: r.kind,
            status: r.status,
            triggeredBy: r.triggeredBy,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
            invoicesUpserted: r.invoicesUpserted,
            invoicesDeleted: r.invoicesDeleted,
            apiRequests: r.apiRequests,
            note: r.note,
            error: r.error,
          }))}
        />
      </section>

      <section aria-labelledby="users-heading" className="flex flex-col gap-3">
        <h2 id="users-heading" className="text-lg font-semibold">
          Who can sign in
        </h2>
        <p className="text-sm opacity-70">
          Only these addresses can see the dashboard. Changes take effect on the person&apos;s next page load.
        </p>
        <AllowList
          me={email}
          users={users.map((u) => ({
            email: u.email,
            role: u.role,
            addedBy: u.addedBy,
            createdAt: u.createdAt.toISOString(),
          }))}
        />
      </section>
    </main>
  );
}
