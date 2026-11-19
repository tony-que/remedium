import { MINOR_VERSION } from "./config";

// Read-only QuickBooks Accounting API client: query (with paging), COUNT and
// Change Data Capture. Retries throttling and server errors with exponential
// backoff, and refreshes the token once on a 401.

export const PAGE_SIZE = 1000;
export const MAX_TRIES = 5;

export class QboApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly intuitTid: string | null,
  ) {
    super(message);
  }
}

export interface QboClientOptions {
  realmId: string;
  apiBase: string;
  /** Returns an access token; `force` asks for a refreshed one (after a 401). */
  getToken: (force: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Rows per query page (QuickBooks allows up to 1000). */
  pageSize?: number;
  /** Called before each retry, for the run log. */
  onRetry?: (info: { status: number; attempt: number; delayMs: number }) => void;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Delay before retry n (1-based): 1s, 2s, 4s, 8s, honoring Retry-After when it's longer. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const exp = 1000 * 2 ** (attempt - 1);
  const ra = retryAfter ? Number(retryAfter) * 1000 : NaN;
  return Number.isFinite(ra) && ra > exp ? Math.min(ra, 60_000) : exp;
}

/** Shortens Intuit's Fault JSON into one line, for logs and the admin page. */
function faultText(body: string): string {
  try {
    const j = JSON.parse(body) as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };
    const e = j.Fault?.Error?.[0];
    if (e) return [e.code, e.Message, e.Detail].filter(Boolean).join(": ").slice(0, 500);
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

export class QboClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Requests made, for the run log. */
  requests = 0;

  constructor(private readonly opts: QboClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private url(path: string, params: Record<string, string>): string {
    const u = new URL(`${this.opts.apiBase}/v3/company/${encodeURIComponent(this.opts.realmId)}/${path}`);
    u.search = new URLSearchParams({ ...params, minorversion: MINOR_VERSION }).toString();
    return u.toString();
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = this.url(path, params);
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.opts.getToken(false);
      this.requests++;
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;

      const tid = res.headers.get("intuit_tid");
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.opts.getToken(true);
        attempt--; // a token refresh isn't a retry
        continue;
      }
      if (RETRYABLE.has(res.status) && attempt < MAX_TRIES) {
        const delayMs = backoffMs(attempt, res.headers.get("retry-after"));
        this.opts.onRetry?.({ status: res.status, attempt, delayMs });
        await this.sleep(delayMs);
        continue;
      }
      const detail = faultText(await res.text().catch(() => ""));
      const tries = RETRYABLE.has(res.status) ? ` after ${attempt} tries` : "";
      throw new QboApiError(`QuickBooks ${path} request failed (HTTP ${res.status}${tries})${detail ? `: ${detail}` : ""}`, res.status, tid);
    }
  }

  /** Runs `SELECT * FROM <entity> [WHERE …] [ORDERBY …]`, one page at a time, until a page comes back short. */
  async *queryAll<T>(entity: string, where = "", orderBy = ""): AsyncGenerator<T[]> {
    const size = this.opts.pageSize ?? PAGE_SIZE;
    for (let start = 1; ; start += size) {
      const q = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""}${orderBy ? ` ORDERBY ${orderBy}` : ""} STARTPOSITION ${start} MAXRESULTS ${size}`;
      const json = await this.get<{ QueryResponse?: Record<string, unknown> }>("query", { query: q });
      const rows = (json.QueryResponse?.[entity] as T[] | undefined) ?? [];
      if (rows.length > 0) yield rows;
      if (rows.length < size) return;
    }
  }

  async count(entity: string, where = ""): Promise<number> {
    const q = `SELECT COUNT(*) FROM ${entity}${where ? ` WHERE ${where}` : ""}`;
    const json = await this.get<{ QueryResponse?: { totalCount?: number } }>("query", { query: q });
    return json.QueryResponse?.totalCount ?? 0;
  }

  /**
   * Change Data Capture: everything in `entities` created, changed or deleted
   * since `changedSince` (at most 30 days back, at most 1000 per entity).
   */
  async cdc(entities: string[], changedSince: Date): Promise<Record<string, unknown[]>> {
    const json = await this.get<{ CDCResponse?: { QueryResponse?: Record<string, unknown>[] }[] }>("cdc", {
      entities: entities.join(","),
      changedSince: changedSince.toISOString(),
    });
    const out: Record<string, unknown[]> = Object.fromEntries(entities.map((e) => [e, []]));
    for (const block of json.CDCResponse ?? []) {
      for (const qr of block.QueryResponse ?? []) {
        for (const e of entities) {
          const list = qr[e];
          if (Array.isArray(list)) out[e].push(...list);
        }
      }
    }
    return out;
  }
}
