import { describe, expect, it, vi } from "vitest";
import { getQboConfig, qboConfigured, QboConfigError } from "@/lib/qbo/config";
import { authorizeUrl, exchangeCode, QboOAuthError, refreshTokens, revokeToken } from "@/lib/qbo/oauth";
import { statesMatch } from "@/lib/qbo/state";

const env = {
  QBO_CLIENT_ID: "client-id",
  QBO_CLIENT_SECRET: "client-secret",
  QBO_REDIRECT_URI: "http://localhost:3000/api/qbo/callback",
  QBO_ENVIRONMENT: "sandbox",
};
const config = getQboConfig(env);
const NOW = new Date("2026-11-19T12:00:00Z");

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
}

describe("QuickBooks config", () => {
  it("picks the sandbox API for sandbox keys", () => {
    expect(config.apiBase).toBe("https://sandbox-quickbooks.api.intuit.com");
    expect(getQboConfig({ ...env, QBO_ENVIRONMENT: "production", QBO_REDIRECT_URI: "https://x.example/api/qbo/callback" }).apiBase).toBe(
      "https://quickbooks.api.intuit.com",
    );
  });
  it("rejects bad settings", () => {
    expect(qboConfigured({})).toBe(false);
    expect(() => getQboConfig({ ...env, QBO_ENVIRONMENT: "prod" })).toThrow(QboConfigError);
    expect(() => getQboConfig({ ...env, QBO_REDIRECT_URI: "http://localhost:3000/elsewhere" })).toThrow(/callback/);
    expect(() => getQboConfig({ ...env, QBO_ENVIRONMENT: "production" })).toThrow(/https/);
  });
});

describe("QuickBooks OAuth", () => {
  it("builds the authorize URL with the accounting scope and state", () => {
    const url = new URL(authorizeUrl(config, "state-123"));
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      redirect_uri: "http://localhost:3000/api/qbo/callback",
      state: "state-123",
    });
  });

  it("exchanges a code with Basic auth and computes expiry times", async () => {
    const f = fakeFetch(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, x_refresh_token_expires_in: 8726400 });
    const tokens = await exchangeCode(config, "the-code", f, () => NOW);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Basic " + Buffer.from("client-id:client-secret").toString("base64"),
    );
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://localhost:3000/api/qbo/callback",
    });
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.accessTokenExpiresAt.toISOString()).toBe("2026-11-19T13:00:00.000Z");
    expect(tokens.refreshTokenExpiresAt.toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });

  it("reports invalid_grant with Intuit's transaction id and no token", async () => {
    const f = fakeFetch(400, { error: "invalid_grant", error_description: "Token invalid" }, { intuit_tid: "tid-1" });
    const err = await refreshTokens(config, "old-refresh-token", f).catch((e) => e);
    expect(err).toBeInstanceOf(QboOAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(err.status).toBe(400);
    expect(err.intuitTid).toBe("tid-1");
    expect(err.message).not.toContain("old-refresh-token");
    expect(err.message).not.toContain("client-secret");
  });

  it("treats a 200 without tokens as a failure", async () => {
    await expect(refreshTokens(config, "rt", fakeFetch(200, {}))).rejects.toThrow(QboOAuthError);
  });

  it("revokes with a JSON body", async () => {
    const f = fakeFetch(200, {});
    await revokeToken(config, "rt", f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
    expect(JSON.parse(init.body as string)).toEqual({ token: "rt" });
  });
});

describe("OAuth state", () => {
  it("matches only an identical value", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
  });
});
