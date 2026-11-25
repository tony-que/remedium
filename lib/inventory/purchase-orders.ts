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
  Amount?: number;
  Description?: string;
  ItemBasedExpenseLineDetail?: { ItemRef?: QboRef; Qty?: number; UnitPrice?: number };
  AccountBasedExpenseLineDetail?: { AccountRef?: QboRef };
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
  /** Null on category (account) lines. */
  itemQboId: string | null;
  /** The item's or account's name on the PO line. */
  itemName: string | null;
  description: string | null;
  docNumber: string | null;
  vendor: string | null;
  txnDate: string;
  /** DueDate, or ShipDate, or null. */
  expectedDate: string | null;
  /** Quantities: null on lines with no quantity (category lines, or item lines entered as an amount only). */
  ordered: number | null;
  received: number | null;
  remaining: number | null;
  /** The PO line's dollar amount (ordered quantity × cost), or null. */
  amount: number | null;
  /** Cost per unit on the PO line (UnitPrice, else amount ÷ quantity), or null. */
  unitPrice: number | null;
  /** Dollars still to receive: remaining × unit price (or amount less billed, without a quantity), or null. */
  openAmount: number | null;
}

const qtyOf = (l: QboItemLine) => {
  const q = l.ItemBasedExpenseLineDetail?.Qty;
  return typeof q === "number" && Number.isFinite(q) ? q : 0;
};
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const cents = (n: number) => Math.round(n * 100) / 100;
const ymd = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/**
 * Every line of open purchase orders with something still to receive: item
 * lines by quantity, and lines without a quantity (expense category lines, or
 * item lines entered as an amount only) by dollars.
 */
export function openPoLines(pos: QboPurchaseOrder[], bills: QboBill[]): OpenPoLine[] {
  // Billed quantity and dollars per PO line, and quantity per PO + item where the bill line doesn't name the PO line.
  const qtyByLine = new Map<string, number>();
  const amtByLine = new Map<string, number>();
  const qtyByItem = new Map<string, number>();
  for (const bill of bills) {
    for (const l of bill.Line ?? []) {
      const item = l.ItemBasedExpenseLineDetail?.ItemRef?.value;
      for (const t of l.LinkedTxn ?? []) {
        if (t.TxnType !== "PurchaseOrder") continue;
        if (t.TxnLineId) {
          add(qtyByLine, `${t.TxnId}:${t.TxnLineId}`, qtyOf(l));
          add(amtByLine, `${t.TxnId}:${t.TxnLineId}`, num(l.Amount) ?? 0);
        } else if (item) add(qtyByItem, `${t.TxnId}:${item}`, qtyOf(l));
      }
    }
  }

  const out: OpenPoLine[] = [];
  for (const po of pos) {
    if ((po.POStatus ?? "Open") !== "Open") continue;
    const txnDate = ymd(po.TxnDate);
    if (!txnDate) continue;
    const header = {
      poQboId: po.Id,
      docNumber: po.DocNumber?.trim() || null,
      vendor: po.VendorRef?.name?.trim() || null,
      txnDate,
      expectedDate: ymd(po.DueDate) ?? ymd(po.ShipDate),
    };
    (po.Line ?? []).forEach((l, i) => {
      const isItem = l.DetailType === "ItemBasedExpenseLineDetail";
      if (!isItem && l.DetailType !== "AccountBasedExpenseLineDetail") return;
      const lineId = l.Id ?? `#${i + 1}`;
      const item = isItem ? (l.ItemBasedExpenseLineDetail?.ItemRef ?? null) : null;
      const itemName = (item?.name ?? l.AccountBasedExpenseLineDetail?.AccountRef?.name)?.trim() || null;
      const description = l.Description?.trim() || null;
      const lineAmount = num(l.Amount);
      const ordered = qtyOf(l);

      if (!isItem || ordered === 0) {
        // No quantity: what's open is the amount less what's been billed against the line.
        if (lineAmount === null) return;
        const open = cents(lineAmount - (amtByLine.get(`${po.Id}:${lineId}`) ?? 0));
        if (open <= 0) return;
        out.push({ ...header, lineId, itemQboId: item?.value ?? null, itemName, description, ordered: null, received: null, remaining: null, amount: lineAmount, unitPrice: null, openAmount: open });
        return;
      }

      let received = qtyByLine.get(`${po.Id}:${lineId}`) ?? 0;
      // Unattributed billed quantity is used up against this PO's lines for the item in order.
      if (item?.value) {
        const k = `${po.Id}:${item.value}`;
        const pool = qtyByItem.get(k) ?? 0;
        const take = Math.min(pool, Math.max(0, ordered - received));
        if (take > 0) {
          received += take;
          qtyByItem.set(k, pool - take);
        }
      }
      const remaining = cents(ordered - received);
      if (remaining <= 0) return;
      const given = num(l.ItemBasedExpenseLineDetail?.UnitPrice);
      const unitPrice = given ?? (lineAmount !== null ? lineAmount / ordered : null);
      const amount = lineAmount ?? (unitPrice !== null ? cents(unitPrice * ordered) : null);
      out.push({
        ...header,
        lineId,
        itemQboId: item?.value ?? null,
        itemName,
        description,
        ordered,
        received,
        remaining,
        amount,
        unitPrice,
        openAmount: unitPrice !== null ? cents(unitPrice * remaining) : null,
      });
    });
  }
  return out;
}
