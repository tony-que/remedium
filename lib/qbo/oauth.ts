import { AUTHORIZE_URL, REVOKE_URL, SCOPE, TOKEN_URL, type QboConfig } from "./config";

// Intuit OAuth 2.0, with plain fetch. Nothing here logs or returns a token in
// an error message.

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export class QboOAuthError extends Error {
  constructor(
    message: string,
    /** Intuit's error code, e.g. "invalid_grant" (refresh token expired or revoked). */
    readonly code: string | null,
    readonly status: number | null,
    /** intuit_tid response header, for Intuit support. */
    readonly intuitTid: string | null,
  ) {
    super(message);
  }
}

export function authorizeUrl(config: QboConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  return url.toString();
}

function basicAuth(config: QboConfig): string {
  return "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  config: QboConfig,
  body: Record<string, string>,
  what: string,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const tid = res.headers.get("intuit_tid");
  let json: TokenResponse = {};
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    // Non-JSON error page; handled below.
  }
  if (!res.ok || !json.access_token || !json.refresh_token) {
    const code = json.error ?? null;
    const detail = json.error_description ? `: ${json.error_description}` : "";
    throw new QboOAuthError(`QuickBooks ${what} failed (HTTP ${res.status}${code ? `, ${code}` : ""})${detail}`, code, res.status, tid);
  }
  const issued = now().getTime();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(issued + (json.expires_in ?? 3600) * 1000),
    // Intuit's refresh tokens last about 100 days and roll forward on use.
    refreshTokenExpiresAt: new Date(issued + (json.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000),
  };
}

export function exchangeCode(config: QboConfig, code: string, fetchImpl: typeof fetch = fetch, now = () => new Date()) {
  return tokenRequest(
    config,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri },
    "code exchange",
    fetchImpl,
    now,
  );
}

export function refreshTokens(config: QboConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = () => new Date()) {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, "token refresh", fetchImpl, now);
}

/** Revokes a token at Intuit, which also disconnects the app from the company. */
export async function revokeToken(config: QboConfig, token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(config), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new QboOAuthError(`QuickBooks token revoke failed (HTTP ${res.status})`, null, res.status, res.headers.get("intuit_tid"));
  }
}
