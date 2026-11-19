import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "./crypto";
import { getQboConfig, MINOR_VERSION, type QboConfig, type QboEnvironment } from "./config";
import { QboOAuthError, refreshTokens, revokeToken, type TokenSet } from "./oauth";

// The single company-level QuickBooks connection. Tokens are encrypted in
// qbo_connection and only ever decrypted here, on the server. The browser
// sees connectionStatus(), which has no tokens in it.

const ACCESS = "qbo:access_token";
const REFRESH = "qbo:refresh_token";
/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class QboNotConnectedError extends Error {}

export interface ConnectionStatus {
  connected: boolean;
  realmId?: string;
  companyName?: string | null;
  environment?: string;
  /** The stored connection was made with other keys (sandbox vs production). */
  environmentMismatch?: boolean;
  connectedBy?: string;
  connectedAt?: Date;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  lastRefreshedAt?: Date | null;
  lastRefreshError?: string | null;
}

export async function connectionStatus(config: Pick<QboConfig, "environment"> | null): Promise<ConnectionStatus> {
  const row = await prisma.qboConnection.findUnique({ where: { id: 1 } });
  if (!row) return { connected: false };
  return {
    connected: true,
    realmId: row.realmId,
    companyName: row.companyName,
    environment: row.environment,
    environmentMismatch: config ? row.environment !== config.environment : false,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    lastRefreshedAt: row.lastRefreshedAt,
    lastRefreshError: row.lastRefreshError,
  };
}

/**
 * Saves a new connection (replacing any old one) after the OAuth callback.
 *
 * Connecting a different company (another realm id, e.g. moving from the
 * Intuit sandbox to the real company file) clears every synced QuickBooks
 * row and the sync history, in the same transaction, so the next sync is a
 * full backfill of the new company and nothing from the old one lingers.
 * Eaches conversions, the allow-list and the audit log are kept.
 */
export async function saveConnection(
  actor: string,
  realmId: string,
  environment: QboEnvironment,
  tokens: TokenSet,
  companyName: string | null,
): Promise<{ companyChanged: boolean }> {
  const data = {
    realmId,
    environment,
    companyName,
    accessTokenEnc: encrypt(tokens.accessToken, ACCESS),
    refreshTokenEnc: encrypt(tokens.refreshToken, REFRESH),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    lastRefreshedAt: new Date(),
    lastRefreshError: null,
    connectedBy: actor,
    connectedAt: new Date(),
  };
  const companyChanged = await prisma.$transaction(async (tx) => {
    // The company the synced data came from: the current connection, or, after
    // a Disconnect, the last connect/disconnect in the audit log.
    let previousRealm = (await tx.qboConnection.findUnique({ where: { id: 1 }, select: { realmId: true } }))?.realmId;
    if (!previousRealm) {
      const last = await tx.auditLog.findFirst({
        where: { action: { in: ["qbo_connected", "qbo_disconnected"] } },
        orderBy: { id: "desc" },
      });
      const r = (last?.detail as { realmId?: unknown } | null)?.realmId;
      previousRealm = typeof r === "string" ? r : undefined;
    }
    const anySynced = (await tx.syncRun.count()) > 0 || (await tx.invoice.count()) > 0;
    // With synced data but no record of its company, assume it isn't this one.
    const changed = anySynced && previousRealm !== realmId;
    if (changed) {
      await tx.$executeRaw`TRUNCATE invoice_lines, invoices, items, customers, sync_runs RESTART IDENTITY`;
    }
    await tx.qboConnection.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    return changed;
  });
  await audit(actor, "qbo_connected", { realmId, environment, companyName, companyChanged });
  return { companyChanged };
}

export interface AccessToken {
  realmId: string;
  accessToken: string;
  apiBase: string;
}

/**
 * Returns a usable access token, refreshing it first when it's close to
 * expiring or when `force` is set (the sync refreshes before every run).
 * The new refresh token is saved every time. Concurrent callers wait on a
 * row lock, so a rolled-forward refresh token is never lost.
 */
export async function getAccessToken(
  opts: { force?: boolean; config?: QboConfig; fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<AccessToken> {
  const config = opts.config ?? getQboConfig();
  const now = opts.now ?? (() => new Date());

  const outcome = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM qbo_connection WHERE id = 1 FOR UPDATE`;
      const row = await tx.qboConnection.findUnique({ where: { id: 1 } });
      if (!row) throw new QboNotConnectedError("QuickBooks is not connected. An admin needs to connect it.");
      if (row.environment !== config.environment) {
        throw new QboNotConnectedError(
          `The saved QuickBooks connection is for ${row.environment}, but the app now uses ${config.environment} keys. Reconnect QuickBooks.`,
        );
      }

      const fresh = row.accessTokenExpiresAt.getTime() - now().getTime() > REFRESH_MARGIN_MS;
      if (fresh && !opts.force) {
        return { ok: true as const, realmId: row.realmId, accessToken: decrypt(row.accessTokenEnc, ACCESS) };
      }

      try {
        const tokens = await refreshTokens(config, decrypt(row.refreshTokenEnc, REFRESH), opts.fetchImpl, now);
        await tx.qboConnection.update({
          where: { id: 1 },
          data: {
            accessTokenEnc: encrypt(tokens.accessToken, ACCESS),
            refreshTokenEnc: encrypt(tokens.refreshToken, REFRESH),
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
            lastRefreshedAt: now(),
            lastRefreshError: null,
          },
        });
        return { ok: true as const, realmId: row.realmId, accessToken: tokens.accessToken };
      } catch (err) {
        if (err instanceof QboOAuthError) return { ok: false as const, error: err };
        throw err;
      }
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  if (!outcome.ok) {
    // Recorded outside the transaction so the note survives. The sync (step 5)
    // emails the admin when this happens.
    await prisma.qboConnection.update({ where: { id: 1 }, data: { lastRefreshError: outcome.error.message } });
    throw outcome.error;
  }
  return { realmId: outcome.realmId, accessToken: outcome.accessToken, apiBase: config.apiBase };
}

/** Fetches the company's name, to confirm the connection and label it. */
export async function fetchCompanyName(
  apiBase: string,
  realmId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${apiBase}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=${MINOR_VERSION}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new QboOAuthError(`QuickBooks CompanyInfo request failed (HTTP ${res.status})`, null, res.status, res.headers.get("intuit_tid"));
  }
  const json = (await res.json()) as { CompanyInfo?: { CompanyName?: string } };
  return json.CompanyInfo?.CompanyName ?? null;
}

/** Refreshes the token and reads CompanyInfo: the admin page's "Test connection". */
export async function testConnection(actor: string): Promise<string | null> {
  const { realmId, accessToken, apiBase } = await getAccessToken({ force: true });
  const name = await fetchCompanyName(apiBase, realmId, accessToken);
  await prisma.qboConnection.update({ where: { id: 1 }, data: { companyName: name } });
  await audit(actor, "qbo_tested", { realmId, companyName: name });
  return name;
}

/**
 * Disconnects: revokes the refresh token at Intuit (which ends the app's
 * access to the company) and deletes the stored connection. The local row is
 * deleted even if Intuit can't be reached, so the app stops using it.
 */
export async function disconnect(actor: string): Promise<{ revoked: boolean }> {
  const row = await prisma.qboConnection.findUnique({ where: { id: 1 } });
  if (!row) return { revoked: false };
  let revoked = false;
  try {
    await revokeToken(getQboConfig(), decrypt(row.refreshTokenEnc, REFRESH));
    revoked = true;
  } catch (err) {
    console.error("QuickBooks revoke failed; deleting the local connection anyway:", err instanceof Error ? err.message : err);
  }
  await prisma.qboConnection.delete({ where: { id: 1 } });
  await audit(actor, "qbo_disconnected", { realmId: row.realmId, revoked });
  return { revoked };
}

export type DisconnectCheck =
  | { status: "disconnected"; companyName: string | null }
  | { status: "still_connected"; companyName: string | null }
  | { status: "not_connected" }
  | { status: "unknown"; error: string };

/**
 * For the landing page Intuit opens after someone disconnects the app inside
 * QuickBooks. Asks Intuit for a fresh token: if Intuit says the grant is gone
 * (invalid_grant), the stored connection is cleared so the admin page shows
 * "Not connected" at once. Any other failure leaves it alone.
 */
export async function confirmDisconnected(actor: string, opts: { config?: QboConfig; fetchImpl?: typeof fetch } = {}): Promise<DisconnectCheck> {
  const row = await prisma.qboConnection.findUnique({ where: { id: 1 } });
  if (!row) return { status: "not_connected" };
  try {
    await getAccessToken({ force: true, config: opts.config, fetchImpl: opts.fetchImpl });
    return { status: "still_connected", companyName: row.companyName };
  } catch (err) {
    if (err instanceof QboOAuthError && err.code === "invalid_grant") {
      await prisma.qboConnection.deleteMany({ where: { id: 1 } });
      await audit(actor, "qbo_disconnected", { realmId: row.realmId, revoked: true, by: "QuickBooks" });
      return { status: "disconnected", companyName: row.companyName };
    }
    return { status: "unknown", error: err instanceof Error ? err.message : String(err) };
  }
}
