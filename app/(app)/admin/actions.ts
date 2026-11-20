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

// ---------------------------------------------------------------------------
// Reference data: product flags and eaches conversions
// ---------------------------------------------------------------------------

async function runRef(fn: () => Promise<string>): Promise<ActionResult> {
  const { ReferenceDataError } = await import("@/lib/reference-data");
  try {
    const message = await fn();
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof ReferenceDataError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function setItemProductAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { setItemProduct } = await import("@/lib/reference-data");
  return runRef(async () => {
    const v = fd.get("value");
    const value = v === "true" ? true : v === "false" ? false : null;
    const r = await setItemProduct(actor, String(fd.get("qboId") ?? ""), value);
    return `${r.sku} ${r.isProduct ? "counts as a product" : "is left out of SKU views"}${value === null ? " (automatic rule)" : ""}.`;
  });
}

export async function setConversionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { setConversion } = await import("@/lib/reference-data");
  return runRef(async () => {
    const r = await setConversion(actor, String(fd.get("sku") ?? ""), fd.get("eachesPerUnit"));
    return r.previous === null ? `Added ${r.sku}: ${r.eachesPerUnit} eaches per case.` : `${r.sku}: ${r.previous} → ${r.eachesPerUnit} eaches per case.`;
  });
}

export async function deleteConversionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { deleteConversion } = await import("@/lib/reference-data");
  return runRef(async () => {
    const sku = String(fd.get("sku") ?? "");
    await deleteConversion(actor, sku);
    return `Removed the conversion for ${sku}. It now counts as 0 eaches.`;
  });
}

// ---------------------------------------------------------------------------
// Inventory: Orderwerks sync and monthly usage
// ---------------------------------------------------------------------------

export async function syncInventoryAction(): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const { orderwerksConfigured } = await import("@/lib/orderwerks/client");
  if (!orderwerksConfigured()) {
    return { ok: false, message: "Orderwerks isn't connected yet: set ORDERWERKS_API_KEY and ORDERWERKS_API_SECRET in Vercel, then redeploy." };
  }
  const { runInventorySync } = await import("@/lib/inventory/sync");
  const r = await runInventorySync({ trigger: actor });
  revalidatePath("/admin");
  revalidatePath("/inventory");
  if (r.status === "busy") return { ok: false, message: "An inventory sync is already running." };
  if (r.status === "failed") return { ok: false, message: `Inventory sync failed: ${r.error}` };
  return { ok: true, message: `Inventory updated: ${r.skus} SKUs from Orderwerks${r.note ? ` (${r.note})` : ""}.` };
}

/** Max upload size for the usage file: far more than a few hundred SKUs need. */
const MAX_USAGE_BYTES = 512 * 1024;

export async function uploadUsageAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { email: actor } = await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file to upload." };
  if (file.size > MAX_USAGE_BYTES) return { ok: false, message: "That file is too large for a usage table (over 512 KB)." };
  const { parseUsageCsv } = await import("@/lib/usage-csv");
  let rows;
  try {
    rows = parseUsageCsv(await file.text());
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "That file couldn't be read as CSV." };
  }
  const { replaceUsage } = await import("@/lib/usage");
  const r = await replaceUsage(actor, rows);
  revalidatePath("/admin");
  revalidatePath("/inventory");
  return { ok: true, message: `Monthly usage replaced: ${r.count} SKUs.${r.removed ? ` ${r.removed} SKUs from the old table are no longer listed.` : ""}` };
}
