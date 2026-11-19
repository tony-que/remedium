import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

export type AuditAction =
  | "sign_in"
  | "sign_in_denied"
  | "sign_out"
  | "magic_link_requested"
  | "allowed_user_added"
  | "allowed_user_role_changed"
  | "allowed_user_removed"
  | "qbo_connect_started"
  | "qbo_connected"
  | "qbo_connect_failed"
  | "qbo_tested"
  | "qbo_disconnected"
  | "sync_run"
  | "item_product_set"
  | "conversion_set"
  | "conversion_deleted";

export const AUDIT_RETENTION_DAYS = 90;

/** Writes one audit entry. Never throws: a failed audit write must not block sign-in. */
export async function audit(actor: string, action: AuditAction, detail?: Prisma.InputJsonValue): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { actor, action, detail } });
  } catch (err) {
    console.error("audit log write failed", action, err instanceof Error ? err.message : err);
  }
}

/** Deletes entries older than the retention window. Run by the nightly job (build step 5). */
export async function pruneAuditLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}
