import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { QboClient } from "@/lib/qbo/client";
import { getAccessToken } from "@/lib/qbo/connection";
import { mapItem, type QboItem } from "@/lib/qbo/mappers";
import { upsertItems } from "@/lib/sync/store";
import { parseItemName } from "@/lib/items";
import { stockRows } from "./stock";
import { openPoLines, type QboBill, type QboPurchaseOrder } from "./purchase-orders";

// One inventory sync: reads every active QuickBooks item (quantity on hand,
// on sales orders, and purchase cost) and the open purchase orders, and
// replaces inventory_levels and open_po_lines. "On open POs" is what's still
// to be received on open purchase orders (see purchase-orders.ts), because
// QuickBooks doesn't fill in the items' quantity on purchase order. It also refreshes the
// stored items, so cost changes show without waiting for the nightly sync.
// The hourly cron and the admin's Refresh inventory both call
// runInventorySync(); a unique index on inventory_sync_runs lets only one run
// at a time.
//
// QuickBooks changes quantity on hand through transactions without always
// marking the item as changed, so this reads the full item list every time
// rather than relying on Change Data Capture.

/** Purchase orders dated within this many years are read; older ones are assumed closed. */
export const PO_LOOKBACK_YEARS = 3;

/** A run still "running" after this long died without finishing. */
export const ABANDONED_AFTER_MS = 10 * 60 * 1000;

export interface InventorySyncOptions {
  /** "cron", or the email of the admin who pressed Refresh inventory. */
  trigger: string;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  pageSize?: number;
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

  let client: QboClient | null = null;
  try {
    // No forced refresh: the token is refreshed only when it's about to expire
    // (getAccessToken locks the connection row, so this never races the nightly sync).
    const conn = await getAccessToken({ fetchImpl: opts.fetchImpl, now });
    let token = conn.accessToken;
    client = new QboClient({
      realmId: conn.realmId,
      apiBase: conn.apiBase,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      pageSize: opts.pageSize,
      getToken: async (force) => {
        if (force) token = (await getAccessToken({ force: true, fetchImpl: opts.fetchImpl, now })).accessToken;
        return token;
      },
    });

    const items: QboItem[] = [];
    for await (const page of client.queryAll<QboItem>("Item")) {
      items.push(...page);
      await upsertItems(page.filter((i) => (i.FullyQualifiedName ?? i.Name ?? "").trim()).map(mapItem));
    }
    const { rows, duplicateSkus } = stockRows(items);
    if (rows.length === 0) throw new Error("QuickBooks has no active items that track quantity on hand; inventory was left as it was.");

    // Open purchase orders, less what's been billed (received) against them.
    const since = new Date(now());
    since.setUTCFullYear(since.getUTCFullYear() - PO_LOOKBACK_YEARS);
    const pos: QboPurchaseOrder[] = [];
    for await (const page of client.queryAll<QboPurchaseOrder>("PurchaseOrder", `TxnDate >= '${since.toISOString().slice(0, 10)}'`)) pos.push(...page);
    const open = pos.filter((p) => (p.POStatus ?? "Open") === "Open" && p.TxnDate);
    const bills: QboBill[] = [];
    if (open.length) {
      const earliest = open.map((p) => p.TxnDate!.slice(0, 10)).sort()[0];
      for await (const page of client.queryAll<QboBill>("Bill", `TxnDate >= '${earliest}'`)) bills.push(...page);
    }
    const skuOfItem = new Map<string, string>();
    for (const it of items) {
      const fullName = (it.FullyQualifiedName ?? it.Name ?? "").trim();
      if (it.Id && fullName) skuOfItem.set(it.Id, parseItemName(fullName).sku);
    }
    const tracked = new Set(rows.map((r) => r.sku));
    const poLines = openPoLines(open, bills).flatMap((l) => {
      const sku = skuOfItem.get(l.itemQboId);
      return sku && tracked.has(sku) ? [{ ...l, sku }] : [];
    });
    const onOrder = new Map<string, number>();
    for (const l of poLines) onOrder.set(l.sku, (onOrder.get(l.sku) ?? 0) + l.remaining);
    // If QuickBooks ever does report quantity on PO for an item, don't count less than it.
    for (const r of rows) r.qtyIncoming = Math.max(r.qtyIncoming, onOrder.get(r.sku) ?? 0);

    const syncedAt = now();
    const dec = (x: number) => new Prisma.Decimal(x.toFixed(2));
    const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
    await prisma.$transaction([
      prisma.openPoLine.deleteMany({}),
      prisma.openPoLine.createMany({
        data: poLines.map((l) => ({
          poQboId: l.poQboId,
          lineId: l.lineId,
          sku: l.sku,
          itemQboId: l.itemQboId,
          docNumber: l.docNumber,
          vendor: l.vendor,
          txnDate: day(l.txnDate),
          expectedDate: l.expectedDate ? day(l.expectedDate) : null,
          qtyOrdered: dec(l.ordered),
          qtyRemaining: dec(l.remaining),
          syncedAt,
        })),
      }),
      prisma.inventoryLevel.deleteMany({}),
      prisma.inventoryLevel.createMany({
        data: rows.map((r) => ({
          sku: r.sku,
          itemQboId: r.itemQboId,
          name: r.name,
          qtyAvailable: dec(r.qtyAvailable),
          qtyReserved: dec(r.qtyReserved),
          qtyHeld: dec(0),
          qtyIncoming: dec(r.qtyIncoming),
          qtyBackordered: dec(0),
          minQtyOnHand: r.reorderPoint === null ? null : dec(r.reorderPoint),
          sourceUpdatedAt: null,
          syncedAt,
        })),
      }),
    ]);

    const note = [`${items.length} items read`, `${open.length} open POs, ${poLines.length} lines to receive`, duplicateSkus.length ? `same SKU on two items, counted once: ${duplicateSkus.slice(0, 10).join(", ")}` : null]
      .filter(Boolean)
      .join("; ");
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
