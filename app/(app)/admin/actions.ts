"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { AllowListError, addAllowedUser, removeAllowedUser, setRole } from "@/lib/allowlist";

// Server actions for the admin page. Each one re-checks the caller is an
// admin: actions can be posted directly, so the layout's check isn't enough.
// Next.js rejects server-action posts from other origins, which is the CSRF
// protection for these.

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

function parseRole(v: FormDataEntryValue | null): "admin" | "viewer" {
  if (v === "admin" || v === "viewer") return v;
  throw new AllowListError("Choose a role.");
}

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/admin");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AllowListError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function addUserAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  return run(async () => {
    const email = String(fd.get("email") ?? "");
    const role = parseRole(fd.get("role"));
    await addAllowedUser(actor, email, role);
    return `Added ${email.trim().toLowerCase()} as ${role}.`;
  });
}

export async function setRoleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  return run(async () => {
    const email = String(fd.get("email") ?? "");
    const role = parseRole(fd.get("role"));
    await setRole(actor, email, role);
    return `${email} is now ${role}.`;
  });
}

export async function removeUserAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  return run(async () => {
    const email = String(fd.get("email") ?? "");
    await removeAllowedUser(actor, email);
    return `Removed ${email}.`;
  });
}

// ---------------------------------------------------------------------------
// QuickBooks connection
// ---------------------------------------------------------------------------

export async function testQboAction(): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { testConnection, QboNotConnectedError } = await import("@/lib/qbo/connection");
  const { QboOAuthError } = await import("@/lib/qbo/oauth");
  const { QboConfigError } = await import("@/lib/qbo/config");
  try {
    const name = await testConnection(actor);
    revalidatePath("/admin");
    return { ok: true, message: `Connected: token refreshed and ${name ?? "the company"} answered.` };
  } catch (err) {
    revalidatePath("/admin");
    if (err instanceof QboNotConnectedError || err instanceof QboConfigError) return { ok: false, message: err.message };
    if (err instanceof QboOAuthError) {
      const hint = err.code === "invalid_grant" ? " The connection has expired or was revoked: reconnect QuickBooks." : "";
      return { ok: false, message: `${err.message}.${hint}` };
    }
    throw err;
  }
}

export async function disconnectQboAction(): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { disconnect } = await import("@/lib/qbo/connection");
  const { revoked } = await disconnect(actor);
  revalidatePath("/admin");
  return {
    ok: true,
    message: revoked
      ? "Disconnected. QuickBooks access was revoked."
      : "Disconnected here, but Intuit couldn't be reached to revoke access. Remove the app in QuickBooks under Settings → Apps if it still shows.",
  };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncNowAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { runSync } = await import("@/lib/sync/run");
  const mode = fd.get("mode") === "full" ? "full" : "auto";
  const r = await runSync({ trigger: actor, mode });
  revalidatePath("/admin");
  revalidatePath("/");
  if (r.status === "busy") {
    return { ok: false, message: `A sync is already running (started ${r.runningSince.toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT).` };
  }
  if (r.status === "failed") return { ok: false, message: `Sync failed: ${r.error}` };
  const c = r.counts;
  return {
    ok: true,
    message: `Sync done (${r.kind}): ${c.invoicesUpserted} invoices and credit memos updated, ${c.invoicesDeleted} marked deleted, ${c.itemsUpserted} items, ${c.customersUpserted} customers.`,
  };
}
