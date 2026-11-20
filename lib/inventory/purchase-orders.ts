// Open QuickBooks purchase orders: what's still to be received on each line.
// QuickBooks doesn't report quantity on purchase orders through the item
// records, so the inventory sync reads the purchase orders themselves. A PO
// line is reduced by the bill lines linked to it (receiving a PO in
// QuickBooks Online means making a bill from it), and a PO marked Closed
// counts for nothing. Quantities are in QuickBooks units (cases).

export interface QboRef {
  value: string;
  name?: string;
}

export interface QboLinkedTxn {
  TxnId: string;
  TxnType: string;
  TxnLineId?: string;
}

export interface QboItemLine {
  Id?: string;
  DetailType?: string;
  ItemBasedExpenseLineDetail?: { ItemRef?: QboRef; Qty?: number };
  LinkedTxn?: QboLinkedTxn[];
}

export interface QboPurchaseOrder {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  ShipDate?: string;
  POStatus?: string;
  VendorRef?: QboRef;
  Line?: QboItemLine[];
}

export interface QboBill {
  Id: string;
  TxnDate?: string;
  Line?: QboItemLine[];
}

export interface OpenPoLine {
  poQboId: string;
  lineId: string;
  itemQboId: string;
  docNumber: string | null;
  vendor: string | null;
  txnDate: string;
  /** DueDate, or ShipDate, or null. */
  expectedDate: string | null;
  ordered: number;
  received: number;
  remaining: number;
}

const qtyOf = (l: QboItemLine) => {
  const q = l.ItemBasedExpenseLineDetail?.Qty;
  return typeof q === "number" && Number.isFinite(q) ? q : 0;
};
const ymd = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Lines of open purchase orders with something still to receive. */
export function openPoLines(pos: QboPurchaseOrder[], bills: QboBill[]): OpenPoLine[] {
  // Billed quantity per PO line, and per PO + item where the bill line doesn't name the PO line.
  const byLine = new Map<string, number>();
  const byItem = new Map<string, number>();
  for (const bill of bills) {
    for (const l of bill.Line ?? []) {
      const item = l.ItemBasedExpenseLineDetail?.ItemRef?.value;
      for (const t of l.LinkedTxn ?? []) {
        if (t.TxnType !== "PurchaseOrder") continue;
        if (t.TxnLineId) byLine.set(`${t.TxnId}:${t.TxnLineId}`, (byLine.get(`${t.TxnId}:${t.TxnLineId}`) ?? 0) + qtyOf(l));
        else if (item) byItem.set(`${t.TxnId}:${item}`, (byItem.get(`${t.TxnId}:${item}`) ?? 0) + qtyOf(l));
      }
    }
  }

  const out: OpenPoLine[] = [];
  for (const po of pos) {
    if ((po.POStatus ?? "Open") !== "Open") continue;
    const txnDate = ymd(po.TxnDate);
    if (!txnDate) continue;
    (po.Line ?? []).forEach((l, i) => {
      if (l.DetailType !== "ItemBasedExpenseLineDetail") return;
      const item = l.ItemBasedExpenseLineDetail?.ItemRef?.value;
      if (!item) return;
      const ordered = qtyOf(l);
      const lineId = l.Id ?? `#${i + 1}`;
      let received = byLine.get(`${po.Id}:${lineId}`) ?? 0;
      // Unattributed billed quantity is used up against this PO's lines for the item in order.
      const k = `${po.Id}:${item}`;
      const pool = byItem.get(k) ?? 0;
      const take = Math.min(pool, Math.max(0, ordered - received));
      if (take > 0) {
        received += take;
        byItem.set(k, pool - take);
      }
      const remaining = Math.round((ordered - received) * 100) / 100;
      if (remaining <= 0) return;
      out.push({
        poQboId: po.Id,
        lineId,
        itemQboId: item,
        docNumber: po.DocNumber?.trim() || null,
        vendor: po.VendorRef?.name?.trim() || null,
        txnDate,
        expectedDate: ymd(po.DueDate) ?? ymd(po.ShipDate),
        ordered,
        received,
        remaining,
      });
    });
  }
  return out;
}
