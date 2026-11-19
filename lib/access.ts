import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Role } from "@/lib/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth-rules";
import { RETURN_TO_HEADER, signInUrl } from "@/lib/return-to";

// The one place that decides who may see what. Every page, server action and
// API route goes through these helpers; nothing trusts the browser.

export type Access =
  | { status: "signed_out" }
  | { status: "no_access"; email: string }
  | { status: "ok"; email: string; role: Role };

/** Who is asking, and what the allow-list says about them. Cached per request. */
export const getAccess = cache(async (): Promise<Access> => {
  const session = await auth();
  const email = normalizeEmail(session?.user?.email);
  if (!email) return { status: "signed_out" };
  const row = await prisma.allowedUser.findUnique({ where: { email } });
  return row ? { status: "ok", email, role: row.role } : { status: "no_access", email };
});

/** For pages: signed-in and on the allow-list, or redirect (back here after signing in). */
export async function requireViewer(): Promise<{ email: string; role: Role }> {
  const access = await getAccess();
  if (access.status === "signed_out") redirect(signInUrl((await headers()).get(RETURN_TO_HEADER)));
  if (access.status === "no_access") redirect("/no-access");
  return access;
}

/** For admin pages and every admin server action. */
export async function requireAdmin(): Promise<{ email: string; role: "admin" }> {
  const access = await requireViewer();
  if (access.role !== "admin") redirect("/no-access?need=admin");
  return { email: access.email, role: "admin" };
}

/**
 * For API routes: returns the caller's access, or a 401/403 JSON response.
 *
 *   const gate = await apiGate("admin");
 *   if (gate instanceof NextResponse) return gate;
 */
export async function apiGate(need: Role = "viewer"): Promise<{ email: string; role: Role } | NextResponse> {
  const access = await getAccess();
  if (access.status === "signed_out") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (access.status === "no_access" || (need === "admin" && access.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return access;
}
