import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getOrderwerksConfig, OrderwerksClient, stockRows, type OrderwerksConfig, type OwCatalogItem } from "@/lib/orderwerks/client";

// One inventory sync: reads every catalog item from Orderwerks and replaces
// inventory_levels with the stock-tracked SKUs. The hourly cron and the
// admin's Refresh inventory both call runInventorySync(); a unique index on
// inventory_sync_runs lets only one run at a time.

/** A run still "running" after this long died without finishing. */
export const ABANDONED_AFTER_MS = 10 * 60 * 1000;

export interface InventorySyncOptions {
  /** "cron", or the email of the admin who pressed Refresh inventory. */
  trigger: string;
  /** Test seams. */
  config?: OrderwerksConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export type InventorySyncResult =
  | { status: "busy"; runningSince: Date }
  | { status: "succeeded" | "failed"; runId: bigint; skus: number; note: string | null; error: string | null };

export async function runInventorySync(opts: InventorySyncOptions): Promise<InventorySyncResult> {
  const now = opts.now ?? (() => new Date());
  await prisma.inventorySyncRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(now().getTime() - ABANDONED_AFTER_MS) } },
    data: { status: "failed", finishedAt: now(), error: "Abandoned: the run stopped without finishing (timed out or crashed)." },
  });

  let runId: bigint;
  try {
    runId = (await prisma.inventorySyncRun.create({ data: { triggeredBy: opts.trigger, startedAt: now() } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const running = await prisma.inventorySyncRun.findFirst({ where: { status: "running" } });
      return { status: "busy", runningSince: running?.startedAt ?? now() };
    }
    throw err;
  }

  let client: OrderwerksClient | null = null;
  try {
    const config = opts.config ?? getOrderwerksConfig();
    client = new OrderwerksClient({ config, fetchImpl: opts.fetchImpl, sleep: opts.sleep });
    const catalogs = await client.catalogGuids();
    if (catalogs.length === 0) throw new Error("Orderwerks returned no catalogs for this API key.");
    const items: OwCatalogItem[] = [];
    for (const guid of catalogs) items.push(...(await client.catalogItems(guid)));
    const { rows, skippedNoSku, duplicateSkus } = stockRows(items);
    if (rows.length === 0) throw new Error("Orderwerks returned no stock-tracked items with a SKU; inventory was left as it was.");

    const syncedAt = now();
    await prisma.$transaction([
      prisma.inventoryLevel.deleteMany({}),
      prisma.inventoryLevel.createMany({
        data: rows.map((r) => ({
          sku: r.sku,
          catalogItemGuid: r.catalogItemGuid,
          name: r.name,
          qtyAvailable: new Prisma.Decimal(r.qtyAvailable.toFixed(2)),
          qtyReserved: new Prisma.Decimal(r.qtyReserved.toFixed(2)),
          qtyHeld: new Prisma.Decimal(r.qtyHeld.toFixed(2)),
          qtyIncoming: new Prisma.Decimal(r.qtyIncoming.toFixed(2)),
          qtyBackordered: new Prisma.Decimal(r.qtyBackordered.toFixed(2)),
          minQtyOnHand: r.minQtyOnHand === null ? null : new Prisma.Decimal(r.minQtyOnHand.toFixed(2)),
          sourceUpdatedAt: r.sourceUpdatedAt,
          syncedAt,
        })),
      }),
    ]);

    const notes = [`${catalogs.length} catalog${catalogs.length === 1 ? "" : "s"}, ${items.length} items read`];
    if (skippedNoSku) notes.push(`${skippedNoSku} stock item${skippedNoSku === 1 ? "" : "s"} without a SKU skipped`);
    if (duplicateSkus.length) notes.push(`listed in more than one catalog, counted once: ${duplicateSkus.slice(0, 10).join(", ")}`);
    const note = notes.join("; ");
    await prisma.inventorySyncRun.update({
      where: { id: runId },
      data: { status: "succeeded", finishedAt: now(), skus: rows.length, apiRequests: client.requests, note },
    });
    await audit(opts.trigger, "inventory_sync_succeeded", { runId: runId.toString(), skus: rows.length });
    return { status: "succeeded", runId, skus: rows.length, note, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.inventorySyncRun.update({
      where: { id: runId },
      data: { status: "failed", finishedAt: now(), apiRequests: client?.requests ?? 0, error: error.slice(0, 1000) },
    });
    await audit(opts.trigger, "inventory_sync_failed", { runId: runId.toString(), error: error.slice(0, 300) });
    return { status: "failed", runId, skus: 0, note: null, error };
  }
}
