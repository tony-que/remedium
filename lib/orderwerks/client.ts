// Read-only Orderwerks REST API client (https://docs.orderwerks.com):
// catalogs and their catalog items, which carry each SKU's stock figures.
// Authenticates with an API key and secret (created in Orderwerks under
// Business Settings), which run as the supplier's master user.

export const DEFAULT_BASE_URL = "https://owapi.orderwerks.com";
/** Orderwerks allows up to 100 catalog items per page. */
export const PAGE_LIMIT = 100;
export const MAX_TRIES = 5;
/** A safety stop: 1,000 pages of 100 is far more than one catalog holds. */
const MAX_PAGES = 1000;

type Env = Record<string, string | undefined>;

export interface OrderwerksConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  /** Catalogs to read. Empty means every catalog the key can see. */
  catalogGuids: string[];
}

export class OrderwerksConfigError extends Error {}

export class OrderwerksApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** True when the API key and secret are set, so the dashboard can sync stock. */
export function orderwerksConfigured(env: Env = process.env): boolean {
  return Boolean(env.ORDERWERKS_API_KEY && env.ORDERWERKS_API_SECRET);
}

export function getOrderwerksConfig(env: Env = process.env): OrderwerksConfig {
  const apiKey = env.ORDERWERKS_API_KEY?.trim();
  const apiSecret = env.ORDERWERKS_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new OrderwerksConfigError("Orderwerks is not configured: set ORDERWERKS_API_KEY and ORDERWERKS_API_SECRET.");
  }
  const baseUrl = (env.ORDERWERKS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    new URL(baseUrl);
  } catch {
    throw new OrderwerksConfigError(`ORDERWERKS_BASE_URL "${baseUrl}" is not a URL.`);
  }
  const catalogGuids = (env.ORDERWERKS_CATALOG_GUIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { apiKey, apiSecret, baseUrl, catalogGuids };
}

/** The catalog item fields this app reads. Orderwerks may send numbers as strings. */
export interface OwCatalogItem {
  guid?: string;
  sku?: string | null;
  name?: string | null;
  active?: boolean;
  has_inventory?: boolean;
  qty_on_hand?: number | string | null;
  reserved_qty_on_hand?: number | string | null;
  qty_held_for_backorders?: number | string | null;
  qty_incoming?: number | string | null;
  qty_backordered?: number | string | null;
  min_qty_on_hand?: number | string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

interface OwCatalog {
  guid?: string;
  catalogGuid?: string;
  catalog_guid?: string;
  name?: string;
}

interface CatalogItemsPage {
  catalog_items?: OwCatalogItem[];
  hasMoreItems?: boolean;
  totalCatalogItems?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function backoffMs(attempt: number, retryAfter: string | null): number {
  const exp = 1000 * 2 ** (attempt - 1);
  const ra = retryAfter ? Number(retryAfter) * 1000 : NaN;
  return Number.isFinite(ra) && ra > exp ? Math.min(ra, 60_000) : exp;
}

/** Orderwerks errors are JSON `{ message, error?, code? }`, or sometimes plain text. */
function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string; error?: string; code?: string };
    const t = [j.code, j.message, j.error].filter(Boolean).join(": ");
    if (t) return t.slice(0, 300);
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

export interface OrderwerksClientOptions {
  config: OrderwerksConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class OrderwerksClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Requests made, for the run log. */
  requests = 0;

  constructor(private readonly opts: OrderwerksClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const u = new URL(`${this.opts.config.baseUrl}${path}`);
    u.search = new URLSearchParams(params).toString();
    for (let attempt = 1; ; attempt++) {
      this.requests++;
      const res = await this.fetchImpl(u.toString(), {
        headers: { "x-apiKey": this.opts.config.apiKey, "x-apiSecret": this.opts.config.apiSecret, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      if (RETRYABLE.has(res.status) && attempt < MAX_TRIES) {
        await this.sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      const detail = errorText(await res.text().catch(() => ""));
      const hint = res.status === 401 || res.status === 403 ? " Check ORDERWERKS_API_KEY and ORDERWERKS_API_SECRET." : "";
      throw new OrderwerksApiError(`Orderwerks ${path} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}.${hint}`, res.status);
    }
  }

  /** The configured catalogs, or every catalog the key can see. */
  async catalogGuids(): Promise<string[]> {
    if (this.opts.config.catalogGuids.length > 0) return this.opts.config.catalogGuids;
    const r = await this.get<{ catalogs?: OwCatalog[]; catalogsDetails?: { catalogGuid?: string }[] }>("/v1/catalogs");
    const guids = [
      ...(r.catalogs ?? []).map((c) => c.guid ?? c.catalogGuid ?? c.catalog_guid),
      ...(r.catalogsDetails ?? []).map((c) => c.catalogGuid),
    ].filter((g): g is string => typeof g === "string" && g.length > 0);
    return [...new Set(guids)];
  }

  /**
   * Every item in a catalog. Orderwerks' `offset` is a page number; pages are
   * read until `hasMoreItems` is false, and items are de-duplicated by guid
   * so a repeated page can never double-count stock.
   */
  async catalogItems(catalogGuid: string): Promise<OwCatalogItem[]> {
    const byGuid = new Map<string, OwCatalogItem>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.get<CatalogItemsPage>(`/v1/catalog/${encodeURIComponent(catalogGuid)}/catalog_items`, {
        limit: String(PAGE_LIMIT),
        offset: String(page),
        skipCategoryRetrieval: "true",
      });
      const items = r.catalog_items ?? [];
      let added = 0;
      for (const it of items) {
        const key = it.guid ?? `${it.sku ?? ""}|${it.name ?? ""}`;
        if (!byGuid.has(key)) {
          byGuid.set(key, it);
          added++;
        }
      }
      if (!r.hasMoreItems || items.length === 0 || added === 0) break;
    }
    return [...byGuid.values()];
  }
}

const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "string" ? Number(v.trim()) : (v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export interface StockRow {
  sku: string;
  catalogItemGuid: string;
  name: string | null;
  qtyAvailable: number;
  qtyReserved: number;
  qtyHeld: number;
  qtyIncoming: number;
  qtyBackordered: number;
  minQtyOnHand: number | null;
  sourceUpdatedAt: Date | null;
}

/**
 * Stock rows from catalog items: only items that track inventory, aren't
 * deleted and have a SKU. A SKU listed in more than one catalog is the same
 * stock, so it's kept once (the first catalog item seen).
 */
export function stockRows(items: OwCatalogItem[]): { rows: StockRow[]; skippedNoSku: number; duplicateSkus: string[] } {
  const bySku = new Map<string, StockRow>();
  const duplicates = new Set<string>();
  let skippedNoSku = 0;
  for (const it of items) {
    if (it.has_inventory === false || it.deleted_at) continue;
    const sku = (it.sku ?? "").trim();
    if (!sku) {
      skippedNoSku++;
      continue;
    }
    if (bySku.has(sku)) {
      if (bySku.get(sku)!.catalogItemGuid !== it.guid) duplicates.add(sku);
      continue;
    }
    const updated = it.updated_at ? new Date(it.updated_at) : null;
    bySku.set(sku, {
      sku,
      catalogItemGuid: it.guid ?? "",
      name: it.name?.trim() || null,
      qtyAvailable: n(it.qty_on_hand),
      qtyReserved: n(it.reserved_qty_on_hand),
      qtyHeld: n(it.qty_held_for_backorders),
      qtyIncoming: n(it.qty_incoming),
      qtyBackordered: n(it.qty_backordered),
      minQtyOnHand: it.min_qty_on_hand === null || it.min_qty_on_hand === undefined ? null : n(it.min_qty_on_hand),
      sourceUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    });
  }
  return { rows: [...bySku.values()], skippedNoSku, duplicateSkus: [...duplicates] };
}
