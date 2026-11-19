// Where to send someone after they sign in. Only paths on this site are
// allowed, so a crafted link like /signin?callbackUrl=https://evil.example
// (an "open redirect") can't send people elsewhere.

export const RETURN_TO_HEADER = "x-return-to";

export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return null;
  if (!raw.startsWith("/")) return null; // relative to this site only
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null; // protocol-relative: another host
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null; // control characters, backslashes
  if (raw.startsWith("/api/auth") || raw.startsWith("/signin")) return null; // no sign-in loops
  return raw;
}

/** The sign-in URL that comes back to `returnTo` afterwards (if it's safe). */
export function signInUrl(returnTo: unknown): string {
  const safe = safeReturnTo(returnTo);
  return safe && safe !== "/" ? `/signin?callbackUrl=${encodeURIComponent(safe)}` : "/signin";
}
