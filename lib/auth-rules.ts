// Pure sign-in rules, kept apart from Auth.js so they can be unit tested.

/** Lowercases and trims an email; returns null for anything that isn't one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose: one @, something on each side, a dot in the domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS: a comma-separated list of
 * Microsoft tenant ids (GUIDs). Domains are rejected on purpose, because a
 * token carries the tenant id, never the domain.
 */
export function parseTenantList(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of ids) {
    if (!GUID.test(id)) {
      throw new Error(
        `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS: "${id}" is not a tenant id (GUID). ` +
          "Look a domain's id up at https://login.microsoftonline.com/<domain>/v2.0/.well-known/openid-configuration",
      );
    }
  }
  return ids;
}

/** True when a Microsoft id token's tenant is on the allowed list. */
export function isAllowedTenant(tid: unknown, allowed: readonly string[]): boolean {
  return typeof tid === "string" && allowed.includes(tid.toLowerCase());
}

/** The email a Microsoft id token identifies: `email`, else `preferred_username`. */
export function emailFromEntraProfile(profile: { email?: unknown; preferred_username?: unknown }): string | null {
  return normalizeEmail(profile.email) ?? normalizeEmail(profile.preferred_username);
}
