import type { Role } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/auth-rules";

// Allow-list changes. Callers must already have checked that the actor is an
// admin (lib/access.ts requireAdmin); these functions enforce the data rules.

export class AllowListError extends Error {}

export async function listAllowedUsers() {
  return prisma.allowedUser.findMany({ orderBy: [{ role: "asc" }, { email: "asc" }] });
}

export async function addAllowedUser(actor: string, rawEmail: string, role: Role) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AllowListError(`"${rawEmail}" is not a valid email address.`);
  const existing = await prisma.allowedUser.findUnique({ where: { email } });
  if (existing) throw new AllowListError(`${email} is already on the list.`);
  await prisma.allowedUser.create({ data: { email, role, addedBy: actor } });
  await audit(actor, "allowed_user_added", { email, role });
}

/** Changes a role. Refuses to demote the last admin. */
export async function setRole(actor: string, rawEmail: string, role: Role) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AllowListError("Invalid email.");
  await prisma.$transaction(async (tx) => {
    const row = await tx.allowedUser.findUnique({ where: { email } });
    if (!row) throw new AllowListError(`${email} is not on the list.`);
    if (row.role === role) return;
    if (row.role === "admin" && (await tx.allowedUser.count({ where: { role: "admin" } })) <= 1) {
      throw new AllowListError("There must always be at least one admin.");
    }
    await tx.allowedUser.update({ where: { email }, data: { role } });
  }, { isolationLevel: "Serializable" });
  await audit(actor, "allowed_user_role_changed", { email, role });
}

/** Removes someone. Refuses to remove the last admin, or yourself. */
export async function removeAllowedUser(actor: string, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AllowListError("Invalid email.");
  if (email === normalizeEmail(actor)) throw new AllowListError("You can't remove yourself.");
  await prisma.$transaction(async (tx) => {
    const row = await tx.allowedUser.findUnique({ where: { email } });
    if (!row) throw new AllowListError(`${email} is not on the list.`);
    if (row.role === "admin" && (await tx.allowedUser.count({ where: { role: "admin" } })) <= 1) {
      throw new AllowListError("There must always be at least one admin.");
    }
    await tx.allowedUser.delete({ where: { email } });
  }, { isolationLevel: "Serializable" });
  await audit(actor, "allowed_user_removed", { email });
}
