import { requireAdmin } from "@/lib/access";
import { listAllowedUsers } from "@/lib/allowlist";
import { getQboConfig, qboConfigured } from "@/lib/qbo/config";
import { connectionStatus } from "@/lib/qbo/connection";
import { AllowList } from "./allow-list";
import { QboPanel } from "./qbo-panel";
import { SyncPanel } from "./sync-panel";
import { ConversionsPanel, ItemsPanel } from "./reference-panels";
import { InventorySyncPanel, UsagePanel } from "./inventory-panel";
import { orderwerksConfigured } from "@/lib/orderwerks/client";
import { productSkusWithoutConversion } from "@/lib/reference-data";
import { prisma } from "@/lib/db";

const QBO_FLASH: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "QuickBooks connected." },
  connected_new_company: {
    ok: true,
    message: "Connected to a different company than before, so the old company's synced data was cleared. Press Refresh now to load this company's history.",
  },
  denied: { ok: false, message: "The connection was cancelled in QuickBooks." },
  state_mismatch: { ok: false, message: "That connection link expired or came from another browser. Try Connect again." },
  not_configured: { ok: false, message: "QuickBooks keys aren't set on the server." },
  error: { ok: false, message: "QuickBooks didn't accept the connection. Try again; details are in the server log." },
};

/** Seconds. Refresh now and Full re-read run inside this page's server actions. */
export const maxDuration = 300;

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
  const [items, conversions, missingConversions] = await Promise.all([
    prisma.item.findMany({ where: { itemType: { not: "Category" } }, orderBy: [{ isProduct: "desc" }, { sku: "asc" }] }),
    prisma.skuConversion.findMany({ orderBy: { sku: "asc" } }),
    productSkusWithoutConversion(),
  ]);
  const [inventoryRuns, usage] = await Promise.all([
    prisma.inventorySyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.skuUsage.findMany({ orderBy: { sku: "asc" } }),
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

      <section aria-labelledby="inv-heading" className="flex flex-col gap-2">
        <h2 id="inv-heading" className="text-lg font-semibold">
          Inventory (Orderwerks)
        </h2>
        <p className="text-sm opacity-70">Stock levels refresh from Orderwerks every hour. Refresh inventory now pulls them immediately.</p>
        <InventorySyncPanel
          configured={orderwerksConfigured()}
          runs={inventoryRuns.map((r) => ({
            id: r.id.toString(),
            status: r.status,
            triggeredBy: r.triggeredBy,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
            skus: r.skus,
            note: r.note,
            error: r.error,
          }))}
        />
      </section>

      <section aria-labelledby="usage-heading" className="flex flex-col gap-2">
        <h2 id="usage-heading" className="text-lg font-semibold">
          Monthly usage
        </h2>
        <p className="text-sm opacity-70">
          Your expected usage per SKU, in cases per month. Months of supply uses the greater of this and the last 3 full
          months&apos; average sales. Upload a CSV with the columns <code>sku</code> and <code>monthly_usage</code>; it
          replaces the whole table.
        </p>
        <UsagePanel usage={usage.map((u) => ({ sku: u.sku, monthlyUnits: Number(u.monthlyUnits), updatedBy: u.updatedBy, updatedAt: u.updatedAt.toISOString() }))} />
      </section>

      <section aria-labelledby="conv-heading" className="flex flex-col gap-2">
        <h2 id="conv-heading" className="text-lg font-semibold">
          Eaches conversions
        </h2>
        <p className="text-sm opacity-70">
          Eaches = cases × eaches per case (per pack for Amazon pack variants), by each item&apos;s own SKU (so &ldquo;REMSF99B - AMZ&rdquo; has its own row). A SKU with
          no row counts as 0 eaches.
        </p>
        <ConversionsPanel
          missing={missingConversions}
          conversions={conversions.map((c) => ({
            sku: c.sku,
            eachesPerUnit: c.eachesPerUnit,
            note: c.note,
            updatedBy: c.updatedBy,
            updatedAt: c.updatedAt.toISOString(),
          }))}
        />
      </section>

      <section aria-labelledby="items-heading" className="flex flex-col gap-2">
        <h2 id="items-heading" className="text-lg font-semibold">
          Products
        </h2>
        <p className="text-sm opacity-70">
          Only products appear in the SKU views. Profit share services, shipping, R&amp;D and discount items are left
          out automatically; change any item here, and the sync keeps your choice.
        </p>
        <ItemsPanel
          items={items.map((i) => ({
            qboId: i.qboId,
            sku: i.sku,
            category: i.category,
            itemType: i.itemType,
            active: i.active,
            isProduct: i.isProduct,
            setByAdmin: i.isProductSetByAdmin,
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
