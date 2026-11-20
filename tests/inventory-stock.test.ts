import { describe, expect, it } from "vitest";
import { stockRows } from "@/lib/inventory/stock";

describe("stockRows", () => {
  it("keeps active, non-Amazon items that track quantity, with available = on hand less sales orders", () => {
    const r = stockRows([
      { Id: "1", FullyQualifiedName: "Wound Care Dressings:Silicone Foam Dressings:REMSF99B", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: 10106.2, QtyOnSalesOrder: 106.2, QtyOnPurchaseOrder: 4000, ReorderPoint: 2000, Description: " Foam 9x9 " },
      { Id: "2", FullyQualifiedName: "Mattresses and related:REMEB42803E", Type: "NonInventory", QtyOnHand: 5 },
      { Id: "3", FullyQualifiedName: "Skin Care:SCAF1003", Type: "Inventory", TrackQtyOnHand: false, QtyOnHand: 5 },
      { Id: "4", FullyQualifiedName: "Old:REMOLD", Type: "Inventory", TrackQtyOnHand: true, Active: false, QtyOnHand: 5 },
      { Id: "5", FullyQualifiedName: "Wound Care Dressings:Silicone Foam Dressings:REMSF77B - AMZ", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: -122 },
      { Id: "6", FullyQualifiedName: "Skin Care:SCAF1003-3PK-AMZ", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: 12 },
      { Id: "7", FullyQualifiedName: "Wound Care:REMSF44B", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: 7 },
    ]);
    expect(r.rows).toEqual([
      { sku: "REMSF99B", itemQboId: "1", name: "Foam 9x9", qtyAvailable: 10000, qtyReserved: 106.2, qtyIncoming: 4000, reorderPoint: 2000 },
      { sku: "REMSF44B", itemQboId: "7", name: null, qtyAvailable: 7, qtyReserved: 0, qtyIncoming: 0, reorderPoint: null },
    ]);
  });

  it("counts a SKU once when two active items share it", () => {
    const r = stockRows([
      { Id: "1", FullyQualifiedName: "A:REMWBG22", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: 258 },
      { Id: "2", FullyQualifiedName: "B:REMWBG22", Type: "Inventory", TrackQtyOnHand: true, QtyOnHand: 1 },
    ]);
    expect(r.rows.map((x) => [x.sku, x.qtyAvailable])).toEqual([["REMWBG22", 258]]);
    expect(r.duplicateSkus).toEqual(["REMWBG22"]);
  });
});
