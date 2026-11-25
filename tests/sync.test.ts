import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { saveConnection } from "@/lib/qbo/connection";
import { QboClient, QboApiError, backoffMs } from "@/lib/qbo/client";
import { runSync, ABANDONED_AFTER_MS, type SyncOptions } from "@/lib/sync/run";
import { FakeQbo, doc } from "./helpers/fake-qbo";

let qbo: FakeQbo;
const sleeps: number[] = [];

async function reset() {
  await prisma.$executeRaw`TRUNCATE payment_links, payments, invoice_lines, invoices, items, customers, sync_runs, qbo_connection, audit_log, allowed_users, sku_conversions RESTART IDENTITY CASCADE`;
}

function sync(extra: Partial<SyncOptions> = {}) {
  return runSync({
    trigger: "cron",
    fetchImpl: qbo.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => qbo.now(),
    startDate: "2024-01-01",
    pageSize: 2,
    ...extra,
  });
}

async function totals() {
  const [r] = await prisma.$queryRaw<{ units: Prisma.Decimal | null; sales: Prisma.Decimal | null; lines: bigint }[]>`
    SELECT sum(qty) units, sum(amount) sales, count(*) lines FROM sales_lines`;
  return { units: Number(r.units ?? 0), sales: Number(r.sales ?? 0), lines: Number(r.lines) };
}

beforeEach(async () => {
  await reset();
  sleeps.length = 0;
  qbo = new FakeQbo();
  qbo.items.set("1", { Id: "1", Name: "REMSF99B", FullyQualifiedName: "Wound Care:REMSF99B", Type: "Inventory", Active: true });
  qbo.items.set("2", { Id: "2", Name: "OLDSKU", FullyQualifiedName: "Wound Care:OLDSKU", Type: "Inventory", Active: false });
  qbo.items.set("9", { Id: "9", Name: "Shipping", FullyQualifiedName: "Freight:Shipping", Type: "Service", Active: true });
  qbo.customers.set("58", { Id: "58", DisplayName: "Lakeland Supplychain RDC", Active: true });
  qbo.customers.set("59", { Id: "59", DisplayName: "Closed Hospital", Active: false });
  qbo.putDoc("Invoice", doc("100", "2026-01-05", "58", [["1", 10, 161]]));
  qbo.putDoc("Invoice", doc("101", "2026-02-07", "58", [["1", 5, 161], ["9", 1, 85]]));
  qbo.putDoc("Invoice", doc("102", "2025-06-01", "59", [["2", 3, 50]]));
  qbo.putDoc("Invoice", doc("103", "2023-12-30", "58", [["1", 99, 1]])); // before the start date
  qbo.putDoc("Invoice", doc("104", "2026-03-01", "58", [["1", 1, 161]]));
  qbo.putDoc("CreditMemo", doc("500", "2026-02-10", "58", [["1", 2, 161]]));
  // The first sync starts two hours after these were last edited.
  qbo.tick(2 * 3600_000);

  await saveConnection("admin@example.com", "9341458739894245", "sandbox", {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(qbo.now().getTime() + 3600_000),
    refreshTokenExpiresAt: new Date(qbo.now().getTime() + 100 * 86_400_000),
  }, "Fake Co");
  await prisma.allowedUser.create({ data: { email: "admin@example.com", role: "admin", addedBy: "test" } });
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("first run: full backfill", () => {
  it("loads items (inactive too), customers, invoices and credit memos from the start date", async () => {
    const r = await sync();
    expect(r.status).toBe("succeeded");
    if (r.status !== "succeeded") return;
    expect(r.kind).toBe("full");
    expect(r.note).toBe("First run: full backfill");
    expect(r.counts).toMatchObject({ itemsUpserted: 3, customersUpserted: 2, invoicesUpserted: 5, invoicesDeleted: 0 });

    expect(await prisma.item.count({ where: { active: false } })).toBe(1);
    expect(await prisma.customer.findUnique({ where: { qboId: "59" } })).toMatchObject({ active: false });
    expect(await prisma.invoice.findUnique({ where: { docType_qboId: { docType: "invoice", qboId: "103" } } })).toBeNull();

    // 10 + 5 + 1(shipping) + 3 + 1 - 2 (credit memo)
    expect(await totals()).toEqual({ units: 18, sales: 1610 + 805 + 85 + 150 + 161 - 322, lines: 6 });

    const run = await prisma.syncRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "succeeded", kind: "full", triggeredBy: "cron", invoicesUpserted: 5 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("pages until a short page comes back", async () => {
    await sync();
    const invoicePages = qbo.calls.filter((c) => c.includes("FROM+Invoice") && c.includes("STARTPOSITION"));
    // 4 invoices on/after the start date, 2 per page: pages at 1 and 3 are full, so it asks for 5 too.
    expect(invoicePages.map((c) => decodeURIComponent(c.replace(/\+/g, " ")).match(/STARTPOSITION (\d+)/)![1])).toEqual(["1", "3", "5"]);
  });

  it("refreshes the token before the run and saves the new one", async () => {
    await sync();
    expect(qbo.calls.filter((c) => c.includes("tokens/bearer"))).toHaveLength(1);
    const conn = await prisma.qboConnection.findUniqueOrThrow({ where: { id: 1 } });
    expect(conn.lastRefreshedAt?.getTime()).toBe(qbo.now().getTime());
  });
});

describe("incremental runs (CDC)", () => {
  it("replaces an edited invoice's lines, with no double counting", async () => {
    await sync();
    qbo.tick(3600_000);
    qbo.putDoc("Invoice", doc("100", "2026-01-05", "58", [["1", 12, 161]])); // qty 10 → 12
    const r = await sync();
    expect(r.status === "succeeded" && r.kind).toBe("incremental");
    expect(r.status === "succeeded" && r.counts.invoicesUpserted).toBe(1);
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceQboId: "100" } });
    expect(lines.map((l) => l.qty.toString())).toEqual(["12"]);
    expect((await totals()).units).toBe(20);
  });

  it("asks CDC for changes since the last success's start, less an hour", async () => {
    await sync();
    const firstStart = (await prisma.syncRun.findFirstOrThrow()).startedAt;
    qbo.tick(3600_000);
    await sync();
    const cdc = qbo.calls.find((c) => c.includes("/cdc"))!;
    const since = new URL("http://x" + cdc).searchParams.get("changedSince")!;
    expect(new Date(since).getTime()).toBe(firstStart.getTime() - 3600_000);
    expect(new URL("http://x" + cdc).searchParams.get("entities")).toBe("Invoice,CreditMemo,Item,Customer,Payment");
  });

  it("marks a deleted invoice deleted, and the view drops it", async () => {
    await sync();
    qbo.tick(3600_000);
    qbo.deleteDoc("Invoice", "104");
    const r = await sync();
    expect(r.status === "succeeded" && r.counts.invoicesDeleted).toBe(1);
    expect((await prisma.invoice.findFirstOrThrow({ where: { qboId: "104" } })).deleted).toBe(true);
    expect((await totals()).units).toBe(17);
  });

  it("adds a new credit memo as negative quantities without changing the invoice count", async () => {
    await sync();
    qbo.tick(3600_000);
    qbo.putDoc("CreditMemo", doc("501", "2026-03-02", "58", [["1", 2, 161]]));
    await sync();
    const [r] = await prisma.$queryRaw<{ units: Prisma.Decimal; invoices: bigint }[]>`
      SELECT sum(qty) FILTER (WHERE sku = 'REMSF99B') units,
             count(DISTINCT invoice_qbo_id) FILTER (WHERE doc_type = 'invoice') invoices FROM sales_lines`;
    expect(Number(r.units)).toBe(10 + 5 + 1 - 2 - 2);
    expect(r.invoices).toBe(4n);
  });

  it("ignores an older copy that arrives after a newer one", async () => {
    await sync();
    const stored = await prisma.invoice.findFirstOrThrow({ where: { qboId: "100" } });
    // Pretend the DB already holds a newer version than QuickBooks will send.
    await prisma.invoice.update({ where: { docType_qboId: { docType: "invoice", qboId: "100" } }, data: { lastUpdatedQbo: new Date(stored.lastUpdatedQbo.getTime() + 86_400_000) } });
    qbo.tick(3600_000);
    qbo.putDoc("Invoice", doc("100", "2026-01-05", "58", [["1", 77, 161]]));
    // The fake stamps "now", which is still older than the bumped stored time.
    await sync();
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceQboId: "100" } });
    expect(lines.map((l) => l.qty.toString())).toEqual(["10"]);
  });

  it("falls back to a full re-read when CDC fails, and still catches deletions", async () => {
    await sync();
    qbo.tick(3600_000);
    qbo.deleteDoc("Invoice", "101");
    qbo.cdcFailsWith = 400;
    const r = await sync();
    expect(r.status).toBe("succeeded");
    if (r.status !== "succeeded") return;
    expect(r.kind).toBe("full");
    expect(r.note).toMatch(/^CDC failed \(QuickBooks cdc request failed \(HTTP 400\).*\): full re-read$/);
    expect(r.counts.invoicesDeleted).toBe(1);
    expect((await prisma.invoice.findFirstOrThrow({ where: { qboId: "101" } })).deleted).toBe(true);
  });

  it("runs a full re-read when the last success is over 30 days old", async () => {
    await sync();
    qbo.tick(31 * 86_400_000);
    const r = await sync();
    expect(r.status === "succeeded" && r.kind).toBe("full");
    expect(qbo.calls.some((c) => c.includes("/cdc"))).toBe(false);
  });

  it("never marks anything deleted when a full re-read comes back short", async () => {
    await sync();
    qbo.countSkew = 1; // QuickBooks "counts" one more invoice than it returns
    const r = await sync({ mode: "full" });
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toMatch(/returned 4 records but QuickBooks counts 5; nothing was marked deleted/);
    expect(await prisma.invoice.count({ where: { deleted: true } })).toBe(0);
  });
});

describe("payments and due dates (Accounts Receivable)", () => {
  it("loads due dates and payments, then picks up new and deleted payments by CDC", async () => {
    qbo.putDoc("Invoice", doc("105", "2026-04-01", "58", [["1", 2, 161]], { DueDate: "2026-05-01" }));
    qbo.putPayment("900", "2026-04-20", "58", 400, [["Invoice", "105", 322]]);
    qbo.putPayment("901", "2023-06-01", "58", 10, []); // before the start date
    await sync();
    expect((await prisma.invoice.findFirstOrThrow({ where: { qboId: "105" } })).dueDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect((await prisma.invoice.findFirstOrThrow({ where: { qboId: "100" } })).dueDate?.toISOString().slice(0, 10)).toBe("2026-01-05");
    const p = await prisma.payment.findUniqueOrThrow({ where: { qboId: "900" }, include: { links: true } });
    expect([p.totalAmt.toString(), p.unappliedAmt.toString()]).toEqual(["400", "78"]);
    expect(p.links.map((l) => [l.txnType, l.txnId, l.amount.toString()])).toEqual([["Invoice", "105", "322"]]);
    expect(await prisma.payment.count()).toBe(1);

    qbo.tick(3600_000);
    qbo.putPayment("902", "2026-04-25", "58", 78, []);
    qbo.deleteDoc("Payment", "900");
    const r = await sync();
    expect(r.status === "succeeded" && r.kind).toBe("incremental");
    expect((await prisma.payment.findUniqueOrThrow({ where: { qboId: "900" } })).deleted).toBe(true);
    expect(await prisma.payment.count({ where: { deleted: false } })).toBe(1);
  });

  it("runs one full re-read when stored invoices have no due date yet", async () => {
    await sync();
    await prisma.invoice.updateMany({ where: { docType: "invoice" }, data: { dueDate: null } });
    qbo.tick(3600_000);
    const r = await sync();
    expect(r.status === "succeeded" && [r.kind, r.note]).toEqual(["full", "Loading due dates and payments for Accounts Receivable: full re-read"]);
    expect(await prisma.invoice.count({ where: { docType: "invoice", dueDate: null } })).toBe(0);
    qbo.tick(3600_000);
    const next = await sync();
    expect(next.status === "succeeded" && next.kind).toBe("incremental");
  });
});

describe("items", () => {
  it("keeps a product flag the admin set by hand", async () => {
    await sync();
    await prisma.item.update({ where: { qboId: "9" }, data: { isProduct: true, isProductSetByAdmin: true } });
    await sync({ mode: "full" });
    expect((await prisma.item.findUniqueOrThrow({ where: { qboId: "9" } })).isProduct).toBe(true);
    expect((await prisma.item.findUniqueOrThrow({ where: { qboId: "1" } })).isProduct).toBe(true);
  });
});

describe("lock", () => {
  it("refuses to start while another run is running", async () => {
    await prisma.syncRun.create({ data: { kind: "incremental", triggeredBy: "someone", startedAt: qbo.now() } });
    const r = await sync();
    expect(r.status).toBe("busy");
    expect(await prisma.syncRun.count()).toBe(1);
  });

  it("clears a run abandoned for more than 15 minutes, then runs", async () => {
    await prisma.syncRun.create({
      data: { kind: "incremental", triggeredBy: "crashed", startedAt: new Date(qbo.now().getTime() - ABANDONED_AFTER_MS - 1000) },
    });
    const r = await sync();
    expect(r.status).toBe("succeeded");
    const crashed = await prisma.syncRun.findFirstOrThrow({ where: { triggeredBy: "crashed" } });
    expect(crashed.status).toBe("failed");
    expect(crashed.error).toMatch(/Abandoned/);
  });
});

describe("failures and alerts", () => {
  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = "re_test";
    process.env.EMAIL_FROM = "Sales <sales@example.com>";
  });
  afterAll(() => {
    delete process.env.AUTH_RESEND_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("stops and emails the admin on the first token refresh failure", async () => {
    await sync();
    qbo.refreshFails = true;
    qbo.tick(3600_000);
    const r = await sync();
    expect(r.status).toBe("failed");
    expect(qbo.emails).toHaveLength(1);
    expect(qbo.emails[0]).toMatchObject({ to: ["admin@example.com"], subject: "Remedium Cockpit: QuickBooks connection needs attention" });
    expect(qbo.emails[0].text).not.toMatch(/refresh-|access-/);
    // The dashboard keeps the last good data.
    expect((await totals()).units).toBe(18);

    qbo.tick(3600_000);
    await sync(); // second failure in a row: the token alert already went out
    qbo.tick(3600_000);
    await sync();
    expect(qbo.emails).toHaveLength(1);
  });

  it("emails after the second non-token failure in a row, and not after the third", async () => {
    await sync();
    qbo.countSkew = 1;
    await sync({ mode: "full" });
    expect(qbo.emails).toHaveLength(0);
    await sync({ mode: "full" });
    expect(qbo.emails.map((e) => e.subject)).toEqual(["Remedium Cockpit: QuickBooks sync failed twice in a row"]);
    await sync({ mode: "full" });
    expect(qbo.emails).toHaveLength(1);
    const runs = await prisma.syncRun.findMany({ orderBy: { id: "asc" } });
    expect(runs.map((r) => [r.status, r.alerted])).toEqual([["succeeded", false], ["failed", false], ["failed", true], ["failed", false]]);
  });

  it("logs every run's counts and errors", async () => {
    qbo.countSkew = 1;
    await sync();
    const run = await prisma.syncRun.findFirstOrThrow();
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/QuickBooks counts/);
    expect(run.apiRequests).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "sync_run" } })).toBe(1);
  });
});

describe("QboClient retries", () => {
  const client = (f: FakeQbo, slept: number[]) =>
    new QboClient({
      realmId: "1",
      apiBase: "https://sandbox-quickbooks.api.intuit.com",
      getToken: async () => "t",
      fetchImpl: f.fetch,
      sleep: async (ms) => void slept.push(ms),
    });

  it("backs off 1s, 2s, 4s, 8s on HTTP 429 and then succeeds", async () => {
    const f = new FakeQbo();
    f.throttleNext = 4;
    const slept: number[] = [];
    expect(await client(f, slept).count("Invoice")).toBe(0);
    expect(slept).toEqual([1000, 2000, 4000, 8000]);
  });

  it("gives up after 5 tries", async () => {
    const f = new FakeQbo();
    f.throttleNext = 5;
    const slept: number[] = [];
    const err = await client(f, slept).count("Invoice").catch((e) => e);
    expect(err).toBeInstanceOf(QboApiError);
    expect(err.message).toMatch(/HTTP 429 after 5 tries/);
    expect(slept).toHaveLength(4);
  });

  it("honors a longer Retry-After, capped at a minute", () => {
    expect(backoffMs(1, "5")).toBe(5000);
    expect(backoffMs(3, "1")).toBe(4000);
    expect(backoffMs(1, "600")).toBe(60_000);
  });
});
