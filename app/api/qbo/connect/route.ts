import { NextResponse } from "next/server";
import { getAccess } from "@/lib/access";
import { signInUrl } from "@/lib/return-to";
import { audit } from "@/lib/audit";
import { getQboConfig, QboConfigError } from "@/lib/qbo/config";
import { authorizeUrl } from "@/lib/qbo/oauth";
import { newState, STATE_COOKIE, STATE_MAX_AGE_S } from "@/lib/qbo/state";

export const dynamic = "force-dynamic";

/**
 * Admin only: starts the QuickBooks OAuth flow. This is also the
 * "Connect/Reconnect URL" registered with Intuit, so people can arrive here
 * from QuickBooks without being signed in: they go to sign-in and come back.
 */
export async function GET(req: Request) {
  const access = await getAccess();
  if (access.status === "signed_out") return NextResponse.redirect(new URL(signInUrl("/api/qbo/connect"), req.url));
  if (access.status !== "ok" || access.role !== "admin") {
    return NextResponse.redirect(new URL(access.status === "ok" ? "/no-access?need=admin" : "/no-access", req.url));
  }
  const gate = { email: access.email };

  let config;
  try {
    config = getQboConfig();
  } catch (err) {
    if (err instanceof QboConfigError) return NextResponse.redirect(new URL("/admin?qbo=not_configured", req.url));
    throw err;
  }

  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(config, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    // Lax, so the cookie comes back on Intuit's top-level redirect to the callback.
    sameSite: "lax",
    path: "/api/qbo",
    maxAge: STATE_MAX_AGE_S,
  });
  await audit(gate.email, "qbo_connect_started", { environment: config.environment });
  return res;
}
