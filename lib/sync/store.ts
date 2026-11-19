import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { DocRow, DocType } from "@/lib/qbo/mappers";
import type { mapCustomer, mapItem } from "@/lib/qbo/mappers";

// Database writes for the sync. Each page of documents is written in one
// transaction: the invoice row is upserted and all of its lines replaced, so
// an edited invoice can never double count.

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

export interface UpsertResult {
  upserted: number;
  /** Copies no newer than the stored one (CDC overlap, or late arrivals). */
  skippedStale: number;
}

/**
 * Writes documents newer than the stored copy. With `rewriteUnchanged` (full
 * re-reads), documents at the same version are rewritten too, so a change to
 * the mapping rules reaches every stored row.
 */
export async function upsertDocs(rows: DocRow[], opts: { rewriteUnchanged?: boolean } = {}): Promise<UpsertResult> {
  if (rows.length === 0) return { upserted: 0, skippedStale: 0 };
  const docType = rows[0].docType;
  if (rows.some((r) => r.docType !== docType)) throw new Error("upsertDocs: one document type per call");

  // The same document can appear twice in one batch; keep its newest copy.
  const newest = new Map<string, DocRow>();
  for (const r of rows) {
    const prev = newest.get(r.qboId);
    if (!prev || r.lastUpdatedQbo >= prev.lastUpdatedQbo) newest.set(r.qboId, r);
  }
  const batch = [...newest.values()];

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.invoice.findMany({
        where: { docType, qboId: { in: batch.map((r) => r.qboId) } },
        select: { qboId: true, lastUpdatedQbo: true },
      });
      const stored = new Map(existing.map((e) => [e.qboId, e.lastUpdatedQbo]));
      const keep = batch.filter((r) => {
        const s = stored.get(r.qboId);
        if (!s) return true;
        return opts.rewriteUnchanged ? r.lastUpdatedQbo >= s : r.lastUpdatedQbo > s;
      });

      for (const r of keep) {
        const data = {
          docNumber: r.docNumber,
          txnDate: day(r.txnDate),
          customerQboId: r.customerQboId,
          customerName: r.customerName,
          totalAmt: new Prisma.Decimal(r.totalAmt),
          balance: new Prisma.Decimal(r.balance),
          lastUpdatedQbo: r.lastUpdatedQbo,
          deleted: false,
          syncedAt: new Date(),
        };
        await tx.invoice.upsert({
          where: { docType_qboId: { docType, qboId: r.qboId } },
          create: { docType, qboId: r.qboId, ...data },
          update: data,
        });
      }

      const ids = keep.map((r) => r.qboId);
      if (ids.length > 0) {
        await tx.invoiceLine.deleteMany({ where: { docType, invoiceQboId: { in: ids } } });
        const lines = keep.flatMap((r) =>
          r.lines.map((l) => ({
            docType,
            invoiceQboId: r.qboId,
            lineNum: l.lineNum,
            itemQboId: l.itemQboId,
            itemName: l.itemName,
            qty: new Prisma.Decimal(l.qty),
            unitPrice: new Prisma.Decimal(l.unitPrice),
            amount: new Prisma.Decimal(l.amount),
            description: l.description,
          })),
        );
        if (lines.length > 0) await tx.invoiceLine.createMany({ data: lines });
      }
      return { upserted: keep.length, skippedStale: batch.length - keep.length };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** Marks documents QuickBooks reports as deleted. Their rows stay, hidden by sales_lines. */
export async function markDeleted(docType: DocType, qboIds: string[]): Promise<number> {
  if (qboIds.length === 0) return 0;
  const { count } = await prisma.invoice.updateMany({
    where: { docType, qboId: { in: qboIds }, deleted: false },
    data: { deleted: true, syncedAt: new Date() },
  });
  return count;
}

/**
 * After a complete re-read of QuickBooks from `startDate`: marks as deleted
 * every stored document in that range that QuickBooks no longer returned.
 */
export async function reconcileDeleted(docType: DocType, seenIds: Set<string>, startDate: string): Promise<number> {
  const { count } = await prisma.invoice.updateMany({
    where: { docType, deleted: false, txnDate: { gte: day(startDate) }, qboId: { notIn: [...seenIds] } },
    data: { deleted: true, syncedAt: new Date() },
  });
  return count;
}

export async function upsertItems(items: ReturnType<typeof mapItem>[]): Promise<number> {
  if (items.length === 0) return 0;
  const locked = new Set(
    (
      await prisma.item.findMany({
        where: { qboId: { in: items.map((i) => i.qboId) }, isProductSetByAdmin: true },
        select: { qboId: true },
      })
    ).map((i) => i.qboId),
  );
  await prisma.$transaction(
    items.map((i) => {
      // Never overwrite a product flag the admin set by hand.
      const { isProduct, ...rest } = i;
      return prisma.item.upsert({
        where: { qboId: i.qboId },
        create: i,
        update: locked.has(i.qboId) ? rest : { ...rest, isProduct },
      });
    }),
  );
  return items.length;
}

export async function upsertCustomers(customers: ReturnType<typeof mapCustomer>[]): Promise<number> {
  if (customers.length === 0) return 0;
  await prisma.$transaction(
    customers.map((c) => prisma.customer.upsert({ where: { qboId: c.qboId }, create: c, update: c })),
  );
  return customers.length;
}
