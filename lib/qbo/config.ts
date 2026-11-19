// QuickBooks Online settings, read from server-side environment variables only.

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  apiBase: string;
}

export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
/** Read-only use, but this is the only accounting scope Intuit offers. */
export const SCOPE = "com.intuit.quickbooks.accounting";
/** Intuit retired minor versions below 75 in 2025. */
export const MINOR_VERSION = "75";

const API_BASE: Record<QboEnvironment, string> = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
};

/** Just the variables this module reads, so tests can pass a plain object. */
type Env = Record<string, string | undefined>;

export class QboConfigError extends Error {}

/** True when every QuickBooks variable is set, so the admin page can offer Connect. */
export function qboConfigured(env: Env = process.env): boolean {
  return Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET && env.QBO_REDIRECT_URI && env.QBO_ENVIRONMENT);
}

export function getQboConfig(env: Env = process.env): QboConfig {
  const { QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENVIRONMENT } = env;
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET || !QBO_REDIRECT_URI || !QBO_ENVIRONMENT) {
    throw new QboConfigError(
      "QuickBooks is not configured: set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI and QBO_ENVIRONMENT.",
    );
  }
  if (QBO_ENVIRONMENT !== "sandbox" && QBO_ENVIRONMENT !== "production") {
    throw new QboConfigError(`QBO_ENVIRONMENT must be "sandbox" or "production", not "${QBO_ENVIRONMENT}".`);
  }
  let redirect: URL;
  try {
    redirect = new URL(QBO_REDIRECT_URI);
  } catch {
    throw new QboConfigError(`QBO_REDIRECT_URI "${QBO_REDIRECT_URI}" is not a URL.`);
  }
  if (redirect.pathname !== "/api/qbo/callback") {
    throw new QboConfigError("QBO_REDIRECT_URI must point at this app's /api/qbo/callback route.");
  }
  if (QBO_ENVIRONMENT === "production" && redirect.protocol !== "https:") {
    throw new QboConfigError("Production QuickBooks keys need an https QBO_REDIRECT_URI.");
  }
  return {
    clientId: QBO_CLIENT_ID,
    clientSecret: QBO_CLIENT_SECRET,
    redirectUri: QBO_REDIRECT_URI,
    environment: QBO_ENVIRONMENT,
    apiBase: API_BASE[QBO_ENVIRONMENT],
  };
}
