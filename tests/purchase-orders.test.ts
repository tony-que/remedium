import { describe, expect, it } from "vitest";
import { openPoLines, type QboItemLine } from "@/lib/inventory/purchase-orders";

const line = (id: string, item: string, qty: number, linked?: { po: string; line?: string }): QboItemLine => ({
  Id: id,
  DetailType: "ItemBasedExpenseLineDetail",
  ItemBasedExpenseLineDetail: { ItemRef: { value: item }, Qty: qty },
  LinkedTxn: linked ? [{ TxnId: linked.po, TxnType: "PurchaseOrder", TxnLineId: linked.line }] : undefined,
});

describe("openPoLines", () => {
  it("keeps what's left to receive on open POs, less bills made from them", () => {
    const lines = openPoLines(
      [
        {
          Id: "p1",
          DocNumber: "1042",
          TxnDate: "2026-10-01",
          DueDate: "2026-12-30",
          POStatus: "Open",
          VendorRef: { value: "v1", name: "Acme Mfg" },
          Line: [line("1", "i1", 400), line("2", "i2", 100), { Id: "3", DetailType: "AccountBasedExpenseLineDetail" }],
        },
        { Id: "p2", TxnDate: "2026-09-01", POStatus: "Closed", Line: [line("1", "i1", 999)] },
        { Id: "p3", TxnDate: "2026-11-01", ShipDate: "2027-01-15", Line: [line("1", "i1", 50), line("2", "i1", 50)] },
      ],
      [
        { Id: "b1", Line: [line("1", "i1", 150, { po: "p1", line: "1" })] },
        { Id: "b2", Line: [line("1", "i2", 100, { po: "p1", line: "2" })] },
        // No line id: used up against p3's i1 lines in order.
        { Id: "b3", Line: [line("1", "i1", 70, { po: "p3" })] },
      ],
    );
    expect(lines.map((l) => [l.poQboId, l.lineId, l.itemQboId, l.ordered, l.received, l.remaining, l.expectedDate])).toEqual([
      ["p1", "1", "i1", 400, 150, 250, "2026-12-30"],
      ["p3", "2", "i1", 50, 20, 30, "2027-01-15"],
    ]);
    expect(lines[0]).toMatchObject({ docNumber: "1042", vendor: "Acme Mfg", txnDate: "2026-10-01" });
  });
});
