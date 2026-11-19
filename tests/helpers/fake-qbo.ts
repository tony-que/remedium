import type { QboCustomer, QboDoc, QboItem } from "@/lib/qbo/mappers";

// An in-memory stand-in for Intuit's token endpoint and Accounting API, used
// as the fetch implementation in sync tests. It copies the real API's
// behavior where the sync depends on it:
// * queries return only active Items/Customers unless "Active IN (true, false)"
// * STARTPOSITION / MAXRESULTS paging and SELECT COUNT(*)
// * CDC returns records changed since a time, deleted ones as tombstones

type Entity = "Invoice" | "CreditMemo" | "Item" | "Customer";

export class FakeQbo {
  invoices = new Map<string, QboDoc>();
  creditMemos = new Map<string, QboDoc>();
  items = new Map<string, QboItem>();
  customers = new Map<string, QboCustomer>();
  /** Deleted documents: entity, id, when. */
  tombstones: { entity: Entity; id: string; at: Date }[] = [];

  /** Every request URL, for assertions. */
  calls: string[] = [];
  /** Respond 429 to the next N API (not token) requests. */
  throttleNext = 0;
  /** Fail CDC with this HTTP status. */
  cdcFailsWith: number | null = null;
  /** Token endpoint answers invalid_grant. */
  refreshFails = false;
  /** Report a COUNT this much higher than the truth (to fake a missed page). */
  countSkew = 0;
  /** Captured Resend emails. */
  emails: { to: string[]; subject: string; text: string }[] = [];

  private tokenN = 1;
  private clock = new Date("2026-11-19T12:00:00Z");

  /** Advances the fake's notion of "now", used for LastUpdatedTime. */
  tick(ms = 60_000) {
    this.clock = new Date(this.clock.getTime() + ms);
    return this.clock;
  }
  now() {
    return this.clock;
  }

  private store(entity: Entity): Map<string, QboDoc | QboItem | QboCustomer> {
    return { Invoice: this.invoices, CreditMemo: this.creditMemos, Item: this.items, Customer: this.customers }[entity];
  }

  /** Adds or edits a document, stamping LastUpdatedTime with the fake clock. */
  putDoc(entity: "Invoice" | "CreditMemo", doc: Omit<QboDoc, "MetaData">) {
    const stamped = { ...doc, MetaData: { LastUpdatedTime: this.tick().toISOString() } };
    this.store(entity).set(doc.Id, stamped as QboDoc);
    return stamped;
  }

  deleteDoc(entity: "Invoice" | "CreditMemo", id: string) {
    this.store(entity).delete(id);
    this.tombstones.push({ entity, id, at: this.tick() });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    this.calls.push(url.pathname + url.search);
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

    if (url.hostname === "oauth.platform.intuit.com") {
      if (this.refreshFails) return json({ error: "invalid_grant" }, 400);
      this.tokenN++;
      return json({
        access_token: `access-${this.tokenN}`,
        refresh_token: `refresh-${this.tokenN}`,
        expires_in: 3600,
        x_refresh_token_expires_in: 8726400,
      });
    }
    if (url.hostname === "api.resend.com") {
      this.emails.push(JSON.parse(String(init?.body)));
      return json({ id: "email-1" });
    }
    if (this.throttleNext > 0) {
      this.throttleNext--;
      return json({ Fault: { Error: [{ Message: "ThrottleExceeded", code: "003001" }] } }, 429);
    }

    if (url.pathname.endsWith("/query")) return json(this.query(url.searchParams.get("query") ?? ""));
    if (url.pathname.endsWith("/cdc")) {
      if (this.cdcFailsWith) return json({ Fault: { Error: [{ Message: "CDC unavailable" }] } }, this.cdcFailsWith);
      return json(this.cdc(url.searchParams.get("entities")!.split(","), new Date(url.searchParams.get("changedSince")!)));
    }
    return json({ Fault: { Error: [{ Message: `Unknown path ${url.pathname}` }] } }, 404);
  };

  private query(q: string) {
    const m = q.match(
      /^SELECT (\*|COUNT\(\*\)) FROM (\w+)(?: WHERE (.+?))?(?: ORDERBY (\w+))?(?: STARTPOSITION (\d+) MAXRESULTS (\d+))?$/,
    );
    if (!m) throw new Error(`FakeQbo can't parse query: ${q}`);
    const [, sel, entity, where, orderBy, start, max] = m;
    let rows = [...this.store(entity as Entity).values()] as (QboDoc & QboItem)[];
    if (where?.startsWith("TxnDate >= ")) {
      const d = where.match(/'(.+)'/)![1];
      rows = rows.filter((r) => (r.TxnDate ?? "") >= d);
    }
    if (entity === "Item" || entity === "Customer") {
      if (where !== "Active IN (true, false)") rows = rows.filter((r) => r.Active !== false);
    }
    if (orderBy === "TxnDate") rows.sort((a, b) => (a.TxnDate ?? "").localeCompare(b.TxnDate ?? ""));
    if (sel !== "*") return { QueryResponse: { totalCount: rows.length + this.countSkew } };
    const from = Number(start ?? 1) - 1;
    const page = rows.slice(from, from + Number(max ?? 1000));
    return { QueryResponse: page.length ? { [entity]: page, startPosition: from + 1, maxResults: page.length } : {} };
  }

  private cdc(entities: string[], since: Date) {
    const blocks = entities.map((entity) => {
      const live = ([...this.store(entity as Entity).values()] as QboDoc[]).filter(
        (r) => new Date(r.MetaData?.LastUpdatedTime ?? 0) >= since,
      );
      const dead = this.tombstones
        .filter((t) => t.entity === entity && t.at >= since)
        .map((t) => ({ Id: t.id, status: "Deleted", MetaData: { LastUpdatedTime: t.at.toISOString() } }));
      const list = [...live, ...dead];
      return list.length ? { [entity]: list, startPosition: 1, maxResults: list.length } : {};
    });
    return { CDCResponse: [{ QueryResponse: blocks }], time: this.clock.toISOString() };
  }
}

/** A QuickBooks invoice/credit memo with product lines [itemId, qty, unitPrice]. */
export function doc(id: string, date: string, customer: string, lines: [string, number, number][], extra: Partial<QboDoc> = {}) {
  const Line = [
    ...lines.map(([item, qty, price], i) => ({
      Id: String(i + 1),
      LineNum: i + 1,
      DetailType: "SalesItemLineDetail",
      Amount: Math.round(qty * price * 100) / 100,
      SalesItemLineDetail: { ItemRef: { value: item, name: `Cat:${item}` }, Qty: qty, UnitPrice: price },
    })),
    { DetailType: "SubTotalLineDetail", Amount: 0, SubTotalLineDetail: {} },
  ];
  const total = Line.reduce((s, l) => s + (l.DetailType === "SalesItemLineDetail" ? l.Amount : 0), 0);
  return { Id: id, DocNumber: `D${id}`, TxnDate: date, CustomerRef: { value: customer, name: `Customer ${customer}` }, TotalAmt: total, Balance: total, Line, ...extra };
}
