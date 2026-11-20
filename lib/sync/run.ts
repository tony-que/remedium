import { Prisma, type SyncKind } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { audit, pruneAuditLog } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { QboClient, QboApiError } from "@/lib/qbo/client";
import { getAccessToken } from "@/lib/qbo/connection";
import {
  ENTITY,
  isDeleted,
  mapCustomer,
  mapDoc,
  mapItem,
  type DocType,
  type QboCustomer,
  type QboDoc,
  type QboItem,
} from "@/lib/qbo/mappers";
import { markDeleted, reconcileDeleted, upsertCustomers, upsertDocs, upsertItems } from "./store";

// One sync run. The nightly cron and the admin's Refresh now both call
// runSync(); a unique index on sync_runs lets only one run at a time.
//
// * Incremental (normal): Change Data Capture since the last successful run's
//   start, minus an hour of overlap.
// * Full: re-reads everything since SYNC_START_DATE and marks documents that
//   are gone as deleted. Used for the first backfill, when the admin asks for
//   it, when the last success is too old for CDC (30 days), and as the
//   fallback when CDC fails. (A plain "changed since" query can't see
//   deletions, so a full re-read is the fallback that stays correct.)

export const DEFAULT_START_DATE = "2024-01-01";
const CDC_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CDC_OVERLAP_MS = 3600 * 1000;
/** CDC returns at most this many records per entity; more means we missed some. */
const CDC_ENTITY_LIMIT = 1000;
/** A run still "running" after this long died without finishing. */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;
const DOC_TYPES: DocType[] = ["invoice", "credit_memo"];

export interface SyncOptions {
  /** "cron", or the email of the admin who pressed a button. */
  trigger: string;
  /** "auto" picks incremental or full; "full" forces a full re-read. */
  mode?: "auto" | "full";
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  startDate?: string;
  pageSize?: number;
}

export type SyncResult =
  | { status: "busy"; runningSince: Date }
  | { status: "succeeded" | "failed"; runId: bigint; kind: SyncKind; counts: Counts; note: string | null; error: string | null };

interface Counts {
  invoicesUpserted: number;
  invoicesDeleted: number;
  itemsUpserted: number;
  customersUpserted: number;
  apiRequests: number;
}

export function syncStartDate(env = process.env.SYNC_START_DATE): string {
  const d = env?.trim() || DEFAULT_START_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())) {
    throw new Error(`SYNC_START_DATE "${d}" must be a date like 2024-01-01`);
  }
  return d;
}

/** Marks runs that have been "running" too long as failed, which frees the lock. */
async function clearAbandoned(now: Date): Promise<void> {
  await prisma.syncRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) } },
    data: { status: "failed", finishedAt: now, error: "Abandoned: the run stopped without finishing (timed out or crashed)." },
  });
}

async function lastSuccess() {
  return prisma.syncRun.findFirst({ where: { status: "succeeded" }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] });
}

export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? (() => new Date());
  const startDate = opts.startDate ?? syncStartDate();
  await clearAbandoned(now());

  const prev = await lastSuccess();
  const tooOld = !prev || now().getTime() - prev.startedAt.getTime() > CDC_MAX_AGE_MS - CDC_OVERLAP_MS;
  let kind: SyncKind = opts.mode === "full" || tooOld ? "full" : "incremental";
  let note: string | null = !prev
    ? "First run: full backfill"
    : opts.mode === "full"
      ? "Full re-read requested"
      : tooOld
        ? "Last success over 30 days ago: full re-read"
        : null;

  // Take the lock.
  let runId: bigint;
  try {
    runId = (await prisma.syncRun.create({ data: { kind, triggeredBy: opts.trigger, startedAt: now() } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const running = await prisma.syncRun.findFirst({ where: { status: "running" } });
      return { status: "busy", runningSince: running?.startedAt ?? now() };
    }
    throw err;
  }

  const counts: Counts = { invoicesUpserted: 0, invoicesDeleted: 0, itemsUpserted: 0, customersUpserted: 0, apiRequests: 0 };
  let client: QboClient | null = null;
  let tokenFailure = false;

  try {
    // Always refresh first: it proves the connection works and rolls the
    // refresh token's 100-day window forward.
    let token: string;
    let conn;
    try {
      conn = await getAccessToken({ force: true, fetchImpl: opts.fetchImpl, now });
      token = conn.accessToken;
    } catch (err) {
      tokenFailure = true;
      throw err;
    }
    client = new QboClient({
      realmId: conn.realmId,
      apiBase: conn.apiBase,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      pageSize: opts.pageSize,
      getToken: async (force) => {
        if (force) token = (await getAccessToken({ force: true, fetchImpl: opts.fetchImpl, now })).accessToken;
        return token;
      },
    });

    if (kind === "incremental") {
      const since = new Date(prev!.startedAt.getTime() - CDC_OVERLAP_MS);
      try {
        const changed = await client.cdc(["Invoice", "CreditMemo", "Item", "Customer"], since);
        const full = Object.entries(changed).find(([, list]) => list.length >= CDC_ENTITY_LIMIT);
        if (full) {
          kind = "full";
          note = `CDC returned ${full[1].length} ${full[0]} records (its limit): full re-read`;
        } else {
          await applyCdc(changed, startDate, counts);
          note = `CDC since ${since.toISOString()}`;
        }
      } catch (err) {
        if (!(err instanceof QboApiError)) throw err;
        kind = "full";
        note = `CDC failed (${err.message}): full re-read`;
      }
    }

    if (kind === "full") await fullSync(client, startDate, counts);

    counts.apiRequests = client.requests;
    await prisma.syncRun.update({
      where: { id: runId },
      data: { status: "succeeded", kind, finishedAt: now(), note, ...counts },
    });
    if (opts.trigger === "cron") await pruneAuditLog(now());
    return { status: "succeeded", runId, kind, counts, note, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    counts.apiRequests = client?.requests ?? 0;
    await prisma.syncRun.update({
      where: { id: runId },
      data: { status: "failed", kind, finishedAt: now(), note, error: error.slice(0, 2000), ...counts },
    });
    console.error(`Sync run ${runId} failed:`, error);
    await alertIfNeeded(runId, tokenFailure, error, opts.fetchImpl);
    return { status: "failed", runId, kind, counts, note, error };
  } finally {
    await audit(opts.trigger, "sync_run", { runId: runId.toString(), kind });
  }
}

async function applyCdc(changed: Record<string, unknown[]>, startDate: string, counts: Counts) {
  const items = (changed.Item as QboItem[]).filter((i) => !isDeleted(i)).map(mapItem);
  const customers = (changed.Customer as QboCustomer[]).filter((c) => !isDeleted(c)).map(mapCustomer);
  counts.itemsUpserted += await upsertItems(items);
  counts.customersUpserted += await upsertCustomers(customers);

  for (const docType of DOC_TYPES) {
    const list = changed[ENTITY[docType]] as QboDoc[];
    const deleted = list.filter(isDeleted).map((d) => d.Id);
    const live = list.filter((d) => !isDeleted(d) && (d.TxnDate ?? "") >= startDate).map((d) => mapDoc(docType, d));
    counts.invoicesUpserted += (await upsertDocs(live)).upserted;
    counts.invoicesDeleted += await markDeleted(docType, deleted);
  }
}

async function fullSync(client: QboClient, startDate: string, counts: Counts) {
  // Items and customers first, so lines and invoices resolve to current names.
  // QuickBooks queries return only active records unless asked.
  for await (const page of client.queryAll<QboItem>("Item", "Active IN (true, false)")) {
    counts.itemsUpserted += await upsertItems(page.map(mapItem));
  }
  for await (const page of client.queryAll<QboCustomer>("Customer", "Active IN (true, false)")) {
    counts.customersUpserted += await upsertCustomers(page.map(mapCustomer));
  }

  for (const docType of DOC_TYPES) {
    const entity = ENTITY[docType];
    const where = `TxnDate >= '${startDate}'`;
    const expected = await client.count(entity, where);
    const seen = new Set<string>();
    for await (const page of client.queryAll<QboDoc>(entity, where, "TxnDate")) {
      for (const d of page) seen.add(d.Id);
      counts.invoicesUpserted += (await upsertDocs(page.map((d) => mapDoc(docType, d)), { rewriteUnchanged: true })).upserted;
    }
    // Never mark anything deleted unless the re-read was complete.
    if (seen.size < expected) {
      throw new Error(
        `Full re-read of ${entity} returned ${seen.size} records but QuickBooks counts ${expected}; nothing was marked deleted. Run it again.`,
      );
    }
    counts.invoicesDeleted += await reconcileDeleted(docType, seen, startDate);
  }
}

/**
 * Emails the admins at most once per run of consecutive failures: on the
 * first failure if it's a token problem (syncing can't recover by itself),
 * otherwise on the second failure in a row.
 */
async function alertIfNeeded(runId: bigint, tokenFailure: boolean, error: string, fetchImpl?: typeof fetch) {
  const recent = await prisma.syncRun.findMany({
    where: { status: { in: ["succeeded", "failed"] } },
    orderBy: { id: "desc" },
    take: 50,
  });
  const streak: typeof recent = [];
  for (const r of recent) {
    if (r.status !== "failed") break;
    streak.push(r);
  }
  if (streak.some((r) => r.alerted)) return;
  const isToken = tokenFailure || /invalid_grant|token refresh/i.test(error);
  if (!(isToken || streak.length >= 2)) return;

  const admins = (await prisma.allowedUser.findMany({ where: { role: "admin" }, select: { email: true } })).map((a) => a.email);
  const base = process.env.AUTH_URL ?? "";
  const subject = isToken
    ? "Remedium Cockpit: QuickBooks connection needs attention"
    : "Remedium Cockpit: QuickBooks sync failed twice in a row";
  const body = [
    isToken
      ? "Remedium Cockpit couldn't refresh its QuickBooks access, so syncing has stopped. The dashboard still shows the last good data."
      : "The last two QuickBooks syncs failed. The dashboard still shows the last good data.",
    "",
    `Error: ${error}`,
    "",
    isToken ? `Reconnect QuickBooks on the admin page: ${base}/admin` : `Sync log and Refresh now: ${base}/admin`,
  ].join("\n");
  const { sent } = await sendEmail(admins, subject, body, fetchImpl);
  await prisma.syncRun.update({ where: { id: runId }, data: { alerted: sent } });
}
