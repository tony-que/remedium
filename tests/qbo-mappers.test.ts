import { describe, expect, it } from "vitest";
import { mapCustomer, mapDoc, mapItem, QboMappingError, salesLines, type QboDoc } from "@/lib/qbo/mappers";

const base: QboDoc = {
  Id: "130",
  DocNumber: "1037",
  TxnDate: "2026-03-14",
  CustomerRef: { value: "58", name: "Lakeland Supplychain RDC" },
  TotalAmt: 3220.5,
  Balance: 0,
  MetaData: { LastUpdatedTime: "2026-03-14T10:22:11-07:00" },
  Line: [
    {
      Id: "1",
      LineNum: 1,
      DetailType: "SalesItemLineDetail",
      Amount: 3220,
      Description: " Silicone foam 9x9 ",
      SalesItemLineDetail: { ItemRef: { value: "21", name: "Wound Care Dressings:Silicone Foam Dressings:REMSF99B" }, Qty: 20, UnitPrice: 161 },
    },
    { DetailType: "SubTotalLineDetail", Amount: 3220, SubTotalLineDetail: {} } as never,
    { DetailType: "DiscountLineDetail", Amount: 100 } as never,
    { DetailType: "DescriptionOnly", Description: "Thanks!" } as never,
    {
      DetailType: "SalesItemLineDetail",
      Amount: 0.5,
      SalesItemLineDetail: { ItemRef: { value: "9", name: "Freight:Shipping" } },
    },
  ],
};

describe("mapDoc", () => {
  it("maps header fields", () => {
    const r = mapDoc("invoice", base);
    expect(r).toMatchObject({
      docType: "invoice",
      qboId: "130",
      docNumber: "1037",
      txnDate: "2026-03-14",
      customerQboId: "58",
      customerName: "Lakeland Supplychain RDC",
      totalAmt: "3220.5",
      balance: "0",
    });
    expect(r.lastUpdatedQbo.toISOString()).toBe("2026-03-14T17:22:11.000Z");
  });

  it("keeps only SalesItemLineDetail lines, numbered in order", () => {
    const lines = mapDoc("invoice", base).lines;
    expect(lines).toEqual([
      { lineNum: 1, itemQboId: "21", itemName: "Wound Care Dressings:Silicone Foam Dressings:REMSF99B", qty: "20", unitPrice: "161", amount: "3220", description: "Silicone foam 9x9" },
      // Shipping entered as an item stays in; a line with no Qty counts 0 units.
      { lineNum: 2, itemQboId: "9", itemName: "Freight:Shipping", qty: "0", unitPrice: "0", amount: "0.5", description: null },
    ]);
  });

  it("includes product lines inside a bundle", () => {
    const lines = salesLines({
      ...base,
      Line: [
        {
          DetailType: "GroupLineDetail",
          GroupLineDetail: {
            Line: [
              { DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: 10 } },
              { DetailType: "SalesItemLineDetail", Amount: 20, SalesItemLineDetail: { ItemRef: { value: "2" }, Qty: 2, UnitPrice: 10 } },
            ],
          },
        },
      ],
    });
    expect(lines.map((l) => [l.lineNum, l.itemQboId, l.amount])).toEqual([[1, "1", "10"], [2, "2", "20"]]);
  });

  it("maps a voided invoice to zero rows that stay in", () => {
    const voided = mapDoc("invoice", {
      ...base,
      TotalAmt: 0,
      Line: [{ DetailType: "SalesItemLineDetail", Amount: 0, SalesItemLineDetail: { ItemRef: { value: "21" }, Qty: 0, UnitPrice: 161 } }],
    });
    expect(voided.lines).toHaveLength(1);
    expect([voided.lines[0].qty, voided.lines[0].amount]).toEqual(["0", "0"]);
  });

  it("maps credit memos the same way (the view makes them negative)", () => {
    const r = mapDoc("credit_memo", base);
    expect(r.docType).toBe("credit_memo");
    expect(r.lines[0].qty).toBe("20");
  });

  it.each([
    [{ TxnDate: undefined }, /TxnDate/],
    [{ TxnDate: "03/14/2026" }, /TxnDate/],
    [{ CustomerRef: undefined }, /CustomerRef/],
    [{ MetaData: {} }, /LastUpdatedTime/],
  ])("rejects a document missing required fields (%o)", (patch, msg) => {
    expect(() => mapDoc("invoice", { ...base, ...patch } as QboDoc)).toThrow(msg);
  });

  it("rejects non-numeric amounts", () => {
    const bad = { ...base, TotalAmt: "12" as unknown as number };
    expect(() => mapDoc("invoice", bad)).toThrow(QboMappingError);
  });
});

describe("mapItem / mapCustomer", () => {
  it("derives SKU fields from FullyQualifiedName", () => {
    expect(mapItem({ Id: "22", Name: "REMSF99B - AMZ", FullyQualifiedName: "Amazon:REMSF99B - AMZ", Type: "Inventory", Active: false })).toEqual({
      qboId: "22",
      fullName: "Amazon:REMSF99B - AMZ",
      sku: "REMSF99B - AMZ",
      category: "Amazon",
      baseSku: "REMSF99B",
      isPackVariant: false,
      isProduct: true,
      itemType: "Inventory",
      active: false,
    });
  });

  it("names customers by DisplayName", () => {
    expect(mapCustomer({ Id: "58", DisplayName: " Lakeland Supplychain RDC ", Active: true })).toEqual({
      qboId: "58",
      displayName: "Lakeland Supplychain RDC",
      active: true,
    });
  });
});
