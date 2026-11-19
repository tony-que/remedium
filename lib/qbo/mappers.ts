import { parseItemName } from "@/lib/items";

// Pure functions that turn QuickBooks API JSON into the rows the database
// stores. No I/O here, so every rule is unit tested (tests/qbo-mappers.test.ts).

export type DocType = "invoice" | "credit_memo";

/** QuickBooks entity name for each document type. */
export const ENTITY: Record<DocType, "Invoice" | "CreditMemo"> = { invoice: "Invoice", credit_memo: "CreditMemo" };

interface Ref {
  value?: string;
  name?: string;
}

export interface QboLine {
  Id?: string;
  LineNum?: number;
  DetailType?: string;
  Amount?: number;
  Description?: string;
  SalesItemLineDetail?: { ItemRef?: Ref; Qty?: number; UnitPrice?: number };
  GroupLineDetail?: { Line?: QboLine[] };
}

export interface QboDoc {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  CustomerRef?: Ref;
  TotalAmt?: number;
  Balance?: number;
  MetaData?: { LastUpdatedTime?: string };
  Line?: QboLine[];
  /** Set to "Deleted" on CDC entries for deleted records. */
  status?: string;
}

export interface QboItem {
  Id: string;
  Name?: string;
  FullyQualifiedName?: string;
  Type?: string;
  Active?: boolean;
  status?: string;
}

export interface QboCustomer {
  Id: string;
  DisplayName?: string;
  Active?: boolean;
  status?: string;
}

export interface DocRow {
  docType: DocType;
  qboId: string;
  docNumber: string | null;
  txnDate: string; // YYYY-MM-DD, the company's calendar date
  customerQboId: string;
  customerName: string | null;
  totalAmt: string;
  balance: string;
  lastUpdatedQbo: Date;
  lines: LineRow[];
}

export interface LineRow {
  lineNum: number;
  itemQboId: string | null;
  itemName: string | null;
  qty: string;
  unitPrice: string;
  amount: string;
  description: string | null;
}

export class QboMappingError extends Error {}

/**
 * A JSON number as a decimal string. QuickBooks sends money as JSON numbers;
 * String() gives the shortest exact form (161, 3569612.5) and Postgres rounds
 * it into numeric(14,2) / numeric(12,2), so no binary floating point is summed.
 */
function dec(n: number | undefined | null): string {
  if (n === undefined || n === null) return "0";
  if (typeof n !== "number" || !Number.isFinite(n)) throw new QboMappingError(`Not a number: ${String(n)}`);
  return String(n);
}

export const isDeleted = (o: { status?: string }) => o.status === "Deleted";

/**
 * Product lines of a document: SalesItemLineDetail lines, including those
 * inside a bundle (GroupLineDetail). Subtotal, discount and description-only
 * lines are skipped; discounts and shipping entered as *items* stay in.
 */
export function salesLines(doc: QboDoc): LineRow[] {
  const out: LineRow[] = [];
  const visit = (lines: QboLine[] | undefined) => {
    for (const l of lines ?? []) {
      if (l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail) {
        const d = l.SalesItemLineDetail;
        out.push({
          lineNum: out.length + 1,
          itemQboId: d.ItemRef?.value ?? null,
          itemName: d.ItemRef?.name ?? null,
          qty: dec(d.Qty),
          unitPrice: dec(d.UnitPrice),
          amount: dec(l.Amount),
          description: l.Description?.trim() || null,
        });
      } else if (l.DetailType === "GroupLineDetail") {
        visit(l.GroupLineDetail?.Line);
      }
    }
  };
  visit(doc.Line);
  return out;
}

export function mapDoc(docType: DocType, doc: QboDoc): DocRow {
  if (!doc.Id) throw new QboMappingError(`${ENTITY[docType]} without an Id`);
  if (!doc.TxnDate || !/^\d{4}-\d{2}-\d{2}$/.test(doc.TxnDate)) {
    throw new QboMappingError(`${ENTITY[docType]} ${doc.Id} has no valid TxnDate`);
  }
  if (!doc.CustomerRef?.value) throw new QboMappingError(`${ENTITY[docType]} ${doc.Id} has no CustomerRef`);
  const updated = doc.MetaData?.LastUpdatedTime ? new Date(doc.MetaData.LastUpdatedTime) : null;
  if (!updated || Number.isNaN(updated.getTime())) {
    throw new QboMappingError(`${ENTITY[docType]} ${doc.Id} has no valid MetaData.LastUpdatedTime`);
  }
  return {
    docType,
    qboId: doc.Id,
    docNumber: doc.DocNumber ?? null,
    txnDate: doc.TxnDate,
    customerQboId: doc.CustomerRef.value,
    customerName: doc.CustomerRef.name ?? null,
    totalAmt: dec(doc.TotalAmt),
    balance: dec(doc.Balance),
    lastUpdatedQbo: updated,
    lines: salesLines(doc),
  };
}

export function mapItem(item: QboItem) {
  const fullName = (item.FullyQualifiedName ?? item.Name ?? "").trim();
  if (!item.Id || !fullName) throw new QboMappingError(`Item ${item.Id ?? "?"} has no name`);
  const p = parseItemName(fullName);
  return {
    qboId: item.Id,
    fullName,
    sku: p.sku,
    category: p.category,
    baseSku: p.baseSku,
    isPackVariant: p.isPackVariant,
    isProduct: p.isProduct,
    itemType: item.Type ?? null,
    active: item.Active ?? true,
  };
}

export function mapCustomer(c: QboCustomer) {
  if (!c.Id) throw new QboMappingError("Customer without an Id");
  return { qboId: c.Id, displayName: (c.DisplayName ?? "").trim() || `(customer ${c.Id})`, active: c.Active ?? true };
}
