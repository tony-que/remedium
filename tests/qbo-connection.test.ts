import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/qbo/crypto";
import { getQboConfig } from "@/lib/qbo/config";
import { confirmDisconnected, getAccessToken, QboNotConnectedError, saveConnection } from "@/lib/qbo/connection";
import { QboOAuthError } from "@/lib/qbo/oauth";

// Runs against the test database. Each test starts from a saved connection
// whose access token expires at `expiresAt`.

const config = getQboConfig({
  QBO_CLIENT_ID: "id",
  QBO_CLIENT_SECRET: "secret",
  QBO_REDIRECT_URI: "http://localhost:3000/api/qbo/callback",
  QBO_ENVIRONMENT: "sandbox",
});
const NOW = new Date("2026-11-19T12:00:00Z");
const now = () => NOW;

async function connect(accessExpiresInMs: number) {
  await saveConnection("admin@example.com", "9341450000000000", "sandbox", {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(NOW.getTime() + accessExpiresInMs),
    refreshTokenExpiresAt: new Date(NOW.getTime() + 100 * 86_400_000),
  }, "Sandbox Company_US_1");
}

const tokens = () => ({
  accessToken: "a",
  refreshToken: "r",
  accessTokenExpiresAt: new Date(NOW.getTime() + 3600_000),
  refreshTokenExpiresAt: new Date(NOW.getTime() + 100 * 86_400_000),
});

let refreshCount = 0;
function intuitOk() {
  return vi.fn(async () => {
    refreshCount += 1;
    await new Promise((r) => setTimeout(r, 50)); // a real network call takes time
    return new Response(
      JSON.stringify({
        access_token: `access-${refreshCount + 1}`,
        refresh_token: `refresh-${refreshCount + 1}`,
        expires_in: 3600,
        x_refresh_token_expires_in: 8726400,
      }),
      { status: 200 },
    );
  });
}

beforeEach(async () => {
  refreshCount = 0;
  await prisma.qboConnection.deleteMany();
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.qboConnection.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.$disconnect();
});

describe("QuickBooks connection", () => {
  it("clears synced data and sync history when a different company is connected", async () => {
    await connect(60 * 60_000);
    await prisma.customer.create({ data: { qboId: "c1", displayName: "Sandbox Customer" } });
    await prisma.syncRun.create({ data: { kind: "full", status: "succeeded", triggeredBy: "test" } });
    await prisma.skuConversion.create({ data: { sku: "KEEP", eachesPerUnit: 5, updatedBy: "test" } });
    // Same company again: nothing is cleared.
    expect(await saveConnection("a@example.com", "9341450000000000", "sandbox", tokens(), "Sandbox Company_US_1")).toEqual({ companyChanged: false });
    expect(await prisma.customer.count()).toBe(1);
    // A different company: synced rows and history go, conversions stay.
    expect(await saveConnection("a@example.com", "123145", "production", tokens(), "Remedium")).toEqual({ companyChanged: true });
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.syncRun.count()).toBe(0);
    expect(await prisma.skuConversion.count()).toBe(1);
    await prisma.skuConversion.deleteMany();
  });

  it("keeps synced data when the same company reconnects after a Disconnect", async () => {
    await connect(60 * 60_000);
    await prisma.syncRun.create({ data: { kind: "full", status: "succeeded", triggeredBy: "test" } });
    await prisma.qboConnection.deleteMany(); // what Disconnect does, after its audit entry
    await prisma.auditLog.create({ data: { actor: "a@example.com", action: "qbo_disconnected", detail: { realmId: "9341450000000000" } } });
    expect(await saveConnection("a@example.com", "9341450000000000", "sandbox", tokens(), "Sandbox")).toEqual({ companyChanged: false });
    expect(await prisma.syncRun.count()).toBe(1);
  });

  it("stores tokens encrypted, never in plain text", async () => {
    await connect(60 * 60_000);
    const [row] = await prisma.$queryRaw<{ access_token_enc: string; refresh_token_enc: string }[]>`
      SELECT access_token_enc, refresh_token_enc FROM qbo_connection`;
    expect(row.access_token_enc).not.toContain("access-1");
    expect(row.refresh_token_enc).not.toContain("refresh-1");
    expect(decrypt(row.refresh_token_enc, "qbo:refresh_token")).toBe("refresh-1");
  });

  it("returns the stored token while it has more than 5 minutes left", async () => {
    await connect(30 * 60_000);
    const f = intuitOk();
    const t = await getAccessToken({ config, fetchImpl: f, now });
    expect(t).toEqual({ realmId: "9341450000000000", accessToken: "access-1", apiBase: config.apiBase });
    expect(f).not.toHaveBeenCalled();
  });

  it("refreshes a token that is about to expire and saves the rolled refresh token", async () => {
    await connect(2 * 60_000);
    const t = await getAccessToken({ config, fetchImpl: intuitOk(), now });
    expect(t.accessToken).toBe("access-2");
    const row = await prisma.qboConnection.findUniqueOrThrow({ where: { id: 1 } });
    expect(decrypt(row.refreshTokenEnc, "qbo:refresh_token")).toBe("refresh-2");
    expect(row.accessTokenExpiresAt.toISOString()).toBe("2026-11-19T13:00:00.000Z");
    expect(row.lastRefreshError).toBeNull();
  });

  it("always refreshes when forced (before every sync)", async () => {
    await connect(50 * 60_000);
    const f = intuitOk();
    expect((await getAccessToken({ config, fetchImpl: f, now, force: true })).accessToken).toBe("access-2");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("lets only one of several simultaneous callers refresh", async () => {
    await connect(60_000);
    const f = intuitOk();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => getAccessToken({ config, fetchImpl: f, now })),
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.accessToken))).toEqual(new Set(["access-2"]));
  });

  it("keeps the old tokens and records the error when refresh fails", async () => {
    await connect(60_000);
    const failing = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(getAccessToken({ config, fetchImpl: failing, now })).rejects.toBeInstanceOf(QboOAuthError);
    const row = await prisma.qboConnection.findUniqueOrThrow({ where: { id: 1 } });
    expect(decrypt(row.refreshTokenEnc, "qbo:refresh_token")).toBe("refresh-1");
    expect(row.lastRefreshError).toMatch(/invalid_grant/);
  });

  it("refuses to use a sandbox connection with production keys", async () => {
    await connect(60 * 60_000);
    const prod = { ...config, environment: "production" as const };
    await expect(getAccessToken({ config: prod, now })).rejects.toThrow(QboNotConnectedError);
  });

  it("says so when nothing is connected", async () => {
    await expect(getAccessToken({ config, now })).rejects.toThrow(/not connected/);
  });

  it("logs the connection without any token in the audit detail", async () => {
    await connect(60 * 60_000);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "qbo_connected" } });
    expect(JSON.stringify(log.detail)).not.toMatch(/access-1|refresh-1/);
  });
});

describe("Disconnect URL check", () => {
  it("clears the connection when Intuit says the grant is gone", async () => {
    await connect(60 * 60_000);
    const revoked = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await confirmDisconnected("a@example.com", { config, fetchImpl: revoked })).toEqual({ status: "disconnected", companyName: "Sandbox Company_US_1" });
    expect(await prisma.qboConnection.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "qbo_disconnected" } });
    expect(log.detail).toMatchObject({ realmId: "9341450000000000", by: "QuickBooks" });
  });

  it("leaves a working connection alone", async () => {
    await connect(60 * 60_000);
    expect(await confirmDisconnected("a@example.com", { config, fetchImpl: intuitOk() })).toEqual({ status: "still_connected", companyName: "Sandbox Company_US_1" });
    expect(await prisma.qboConnection.count()).toBe(1);
  });

  it("doesn't clear anything on an unclear failure", async () => {
    await connect(60 * 60_000);
    const down = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    expect((await confirmDisconnected("a@example.com", { config, fetchImpl: down })).status).toBe("unknown");
    expect(await prisma.qboConnection.count()).toBe(1);
  });

  it("reports when nothing was connected", async () => {
    expect(await confirmDisconnected("a@example.com", { config })).toEqual({ status: "not_connected" });
  });
});
