import { parseItemName } from "@/lib/items";
import type { QboItem } from "@/lib/qbo/mappers";

// Turns QuickBooks items into stock rows for the Inventory dashboard.
// Quantities are in QuickBooks units (cases), the same unit as invoices.

export interface StockRow {
  sku: string;
  itemQboId: string;
  name: string | null;
  /** QtyOnHand minus QtyOnSalesOrder. */
  qtyAvailable: number;
  /** QtyOnSalesOrder */
  qtyReserved: number;
  /** QtyOnPurchaseOrder (QuickBooks leaves it empty; the sync fills this from open POs). */
  qtyIncoming: number;
  /** ReorderPoint, or null. */
  reorderPoint: number | null;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Active QuickBooks items that track quantity on hand. A SKU that appears
 * twice (two active items with the same name in different categories) is
 * the same stock in QuickBooks' eyes only once, so it's kept once.
 */
export function stockRows(items: QboItem[]): { rows: StockRow[]; duplicateSkus: string[] } {
  const bySku = new Map<string, StockRow>();
  const duplicates = new Set<string>();
  for (const it of items) {
    if (it.Active === false || it.status === "Deleted") continue;
    if (!(it.TrackQtyOnHand === true || (it.TrackQtyOnHand === undefined && it.Type === "Inventory"))) continue;
    const fullName = (it.FullyQualifiedName ?? it.Name ?? "").trim();
    if (!it.Id || !fullName) continue;
    const sku = parseItemName(fullName).sku;
    if (bySku.has(sku)) {
      duplicates.add(sku);
      continue;
    }
    const onHand = n(it.QtyOnHand);
    const reserved = Math.max(0, n(it.QtyOnSalesOrder));
    bySku.set(sku, {
      sku,
      itemQboId: it.Id,
      name: it.Description?.trim() || null,
      qtyAvailable: onHand - reserved,
      qtyReserved: reserved,
      qtyIncoming: Math.max(0, n(it.QtyOnPurchaseOrder)),
      reorderPoint: typeof it.ReorderPoint === "number" ? it.ReorderPoint : null,
    });
  }
  return { rows: [...bySku.values()], duplicateSkus: [...duplicates] };
}
