import { requireAdmin } from "@/lib/access";
import { listAllowedUsers } from "@/lib/allowlist";
import { getQboConfig, qboConfigured } from "@/lib/qbo/config";
import { connectionStatus } from "@/lib/qbo/connection";
import { AllowList } from "./allow-list";
import { QboPanel } from "./qbo-panel";

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
  const [users, status] = await Promise.all([listAllowedUsers(), connectionStatus(config)]);
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
        <p className="text-sm opacity-70">Sync and Refresh now arrive in build step 5.</p>
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
