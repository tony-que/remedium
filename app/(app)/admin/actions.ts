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
