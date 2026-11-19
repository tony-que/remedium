import { randomBytes, timingSafeEqual } from "node:crypto";

// The OAuth `state` value: random, kept in an HttpOnly cookie on the admin's
// browser, and compared in the callback. It stops anyone from feeding the
// callback a code from a QuickBooks company they chose.

export const STATE_COOKIE = "qbo_oauth_state";
export const STATE_MAX_AGE_S = 10 * 60;

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
