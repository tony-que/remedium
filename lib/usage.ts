import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { UsageRow } from "./usage-csv";

/** Replaces the whole monthly-usage table with the uploaded rows. Callers must have checked the actor is an admin. */
export async function replaceUsage(actor: string, rows: UsageRow[]): Promise<{ count: number; removed: number }> {
  const before = await prisma.skuUsage.count();
  await prisma.$transaction([
    prisma.skuUsage.deleteMany({}),
    prisma.skuUsage.createMany({
      data: rows.map((r) => ({ sku: r.sku, monthlyUnits: new Prisma.Decimal(r.monthlyUnits.toFixed(2)), updatedBy: actor })),
    }),
  ]);
  await audit(actor, "usage_uploaded", { rows: rows.length, previousRows: before });
  return { count: rows.length, removed: Math.max(0, before - rows.length) };
}
