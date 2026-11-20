import { describe, expect, it } from "vitest";
import { getOrderwerksConfig, OrderwerksApiError, OrderwerksClient, OrderwerksConfigError, stockRows, type OwCatalogItem } from "@/lib/orderwerks/client";

const config = { apiKey: "k", apiSecret: "s", baseUrl: "https://ow.test", catalogGuids: [] as string[] };

function fakeFetch(routes: Record<string, (url: URL) => { status?: number; body: unknown }>) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    const r = route(url);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("config", () => {
  it("needs the key and secret, and reads optional catalogs", () => {
    expect(() => getOrderwerksConfig({})).toThrow(OrderwerksConfigError);
    expect(getOrderwerksConfig({ ORDERWERKS_API_KEY: "k", ORDERWERKS_API_SECRET: "s", ORDERWERKS_CATALOG_GUIDS: " a , b " })).toEqual({
      apiKey: "k",
      apiSecret: "s",
      baseUrl: "https://owapi.orderwerks.com",
      catalogGuids: ["a", "b"],
    });
  });
});

describe("OrderwerksClient", () => {
  it("sends the API key headers and lists catalogs", async () => {
    const f = fakeFetch({ "/v1/catalogs": () => ({ body: { catalogs: [{ guid: "c1" }, { guid: "c2" }, { guid: "c1" }] } }) });
    const client = new OrderwerksClient({ config, fetchImpl: f.impl });
    expect(await client.catalogGuids()).toEqual(["c1", "c2"]);
    expect(f.calls[0].headers).toMatchObject({ "x-apiKey": "k", "x-apiSecret": "s" });
  });

  it("pages through catalog items until hasMoreItems is false, never counting an item twice", async () => {
    const pages: OwCatalogItem[][] = [
      [{ guid: "1", sku: "A" }, { guid: "2", sku: "B" }],
      [{ guid: "2", sku: "B" }, { guid: "3", sku: "C" }],
      [{ guid: "4", sku: "D" }],
    ];
    const f = fakeFetch({
      "/v1/catalog/c1/catalog_items": (u) => {
        const page = Number(u.searchParams.get("offset"));
        return { body: { catalog_items: pages[page] ?? [], hasMoreItems: page < pages.length - 1 } };
      },
    });
    const items = await new OrderwerksClient({ config, fetchImpl: f.impl }).catalogItems("c1");
    expect(items.map((i) => i.sku)).toEqual(["A", "B", "C", "D"]);
    expect(f.calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "1", "2"]);
    expect(f.calls[0].url.searchParams.get("limit")).toBe("100");
  });

  it("stops when a page brings nothing new", async () => {
    const f = fakeFetch({ "/v1/catalog/c1/catalog_items": () => ({ body: { catalog_items: [{ guid: "1", sku: "A" }], hasMoreItems: true } }) });
    expect(await new OrderwerksClient({ config, fetchImpl: f.impl }).catalogItems("c1")).toHaveLength(1);
    expect(f.calls).toHaveLength(2);
  });

  it("retries throttling, then reports the error with a hint on bad keys", async () => {
    let n = 0;
    const f = fakeFetch({
      "/v1/catalogs": () => (++n < 3 ? { status: 429, body: "slow down" } : { body: { catalogs: [{ guid: "c1" }] } }),
    });
    const client = new OrderwerksClient({ config, fetchImpl: f.impl, sleep: async () => {} });
    expect(await client.catalogGuids()).toEqual(["c1"]);
    expect(client.requests).toBe(3);

    const bad = fakeFetch({ "/v1/catalogs": () => ({ status: 401, body: { message: "Invalid API key" } }) });
    await expect(new OrderwerksClient({ config, fetchImpl: bad.impl }).catalogGuids()).rejects.toThrow(/HTTP 401.*Invalid API key.*ORDERWERKS_API_KEY/);
    await expect(new OrderwerksClient({ config, fetchImpl: bad.impl }).catalogGuids()).rejects.toBeInstanceOf(OrderwerksApiError);
  });
});

describe("stockRows", () => {
  it("keeps stock-tracked items with a SKU, reads numbers sent as strings, and counts a SKU once", () => {
    const r = stockRows([
      { guid: "1", sku: " REMSF99B ", name: "Foam 9x9", has_inventory: true, qty_on_hand: "120", reserved_qty_on_hand: 10, qty_incoming: "400", updated_at: "2026-11-20T15:00:00Z" },
      { guid: "2", sku: "REMSF99B", has_inventory: true, qty_on_hand: 999 },
      { guid: "3", sku: "SERVICE", has_inventory: false, qty_on_hand: 5 },
      { guid: "4", sku: "", has_inventory: true, qty_on_hand: 5 },
      { guid: "5", sku: "OLD", has_inventory: true, deleted_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ sku: "REMSF99B", name: "Foam 9x9", qtyAvailable: 120, qtyReserved: 10, qtyHeld: 0, qtyIncoming: 400, catalogItemGuid: "1" });
    expect(r.rows[0].sourceUpdatedAt?.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    expect(r.skippedNoSku).toBe(1);
    expect(r.duplicateSkus).toEqual(["REMSF99B"]);
  });
});
