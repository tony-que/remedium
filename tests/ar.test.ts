import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { arSummary, arTrend, bucketOf, trendDates } from "@/lib/ar/queries";

const TODAY = "2026-11-25";
const TABLES = Prisma.sql`TRUNCATE payment_links, payments, invoice_lines, invoices, customers RESTART IDENTITY CASCADE`;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function doc(docType: "invoice" | "credit_memo", id: string, customer: string, date: string, due: string | null, total: number, balance: number) {
  await prisma.invoice.create({
    data: {
      docType,
      qboId: id,
      docNumber: id,
      txnDate: day(date),
      dueDate: due ? day(due) : null,
      customerQboId: customer,
      totalAmt: new Prisma.Decimal(total),
      balance: new Prisma.Decimal(balance),
      lastUpdatedQbo: new Date(),
    },
  });
}

async function payment(id: string, customer: string, date: string, total: number, unapplied: number, links: [string, string, number][]) {
  await prisma.payment.create({
    data: {
      qboId: id,
      txnDate: day(date),
      customerQboId: customer,
      totalAmt: new Prisma.Decimal(total),
      unappliedAmt: new Prisma.Decimal(unapplied),
      lastUpdatedQbo: new Date(),
      links: { create: links.map(([txnType, txnId, amount], i) => ({ lineNum: i + 1, txnType, txnId, amount: new Prisma.Decimal(amount) })) },
    },
  });
}

beforeAll(async () => {
  await prisma.$executeRaw(TABLES);
  await prisma.customer.createMany({
    data: [
      { qboId: "c1", displayName: "Acme Health", active: true },
      { qboId: "c2", displayName: "Beta Clinic", active: true },
    ],
  });
  await doc("invoice", "I1", "c1", "2026-08-01", "2026-08-31", 1000, 1000); // 86 days past due
  await doc("invoice", "I2", "c1", "2026-11-01", "2026-12-01", 500, 200); // current, part paid
  await doc("invoice", "I3", "c2", "2026-07-01", "2026-07-31", 400, 0); // paid Oct 15
  await doc("invoice", "I4", "c2", "2026-10-01", "2026-10-20", 250, 250); // 36 days past due
  await doc("credit_memo", "CM1", "c2", "2026-11-05", null, 50, 50);
  await payment("P1", "c1", "2026-11-10", 300, 0, [["Invoice", "I2", 300]]);
  await payment("P2", "c2", "2026-10-15", 400, 0, [["Invoice", "I3", 400]]);
  await payment("P3", "c1", "2026-11-20", 100, 100, []);
});

afterAll(async () => {
  await prisma.$executeRaw(TABLES);
  await prisma.$disconnect();
});

describe("aging buckets", () => {
  it("puts not-yet-due in current and the rest by days past due", () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual(["current", "current", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90"]);
  });
});

describe("AR summary", () => {
  it("ages open invoices by customer and nets credits and unapplied payments", async () => {
    const ar = await arSummary(TODAY);
    expect(ar.invoices.map((i) => [i.qboId, i.daysPastDue, i.bucket, i.balance])).toEqual([
      ["I1", 86, "d61_90", 1000],
      ["I4", 36, "d31_60", 250],
      ["I2", -6, "current", 200],
    ]);
    expect(ar.customers.map((c) => [c.customer, c.buckets, c.credits, c.net])).toEqual([
      ["Acme Health", { current: 200, d1_30: 0, d31_60: 0, d61_90: 1000, d90: 0 }, 100, 1100],
      ["Beta Clinic", { current: 0, d1_30: 0, d31_60: 250, d61_90: 0, d90: 0 }, 50, 200],
    ]);
    expect(ar.totals).toEqual({
      buckets: { current: 200, d1_30: 0, d31_60: 250, d61_90: 1000, d90: 0 },
      credits: 150,
      openInvoiceBalance: 1450,
      net: 1300,
      pastDue: 1250,
      over90: 0,
    });
    // Last 90 days: I2 500 + I4 250 − CM1 50.
    expect(ar.sales90).toBe(700);
    expect(ar.dso).toBeCloseTo((1300 / 700) * 90, 6);
    expect(ar.missingDueDates).toBe(0);
  });
});

describe("AR trend", () => {
  it("lists month ends, then today, from the first invoice on", () => {
    expect(trendDates(TODAY, 3, null)).toEqual(["2026-08-31", "2026-09-30", "2026-10-31", TODAY]);
    expect(trendDates("2026-01-10", 2, "2025-12-01")).toEqual(["2025-12-31", "2026-01-10"]);
  });

  it("works back from today's balances to each month end", async () => {
    expect(await arTrend(TODAY, 3)).toEqual([
      { asOf: "2026-08-31", net: 1400, pastDue: 400 }, // I1 not yet due; I3 overdue
      { asOf: "2026-09-30", net: 1400, pastDue: 1400 },
      { asOf: "2026-10-31", net: 1250, pastDue: 1250 }, // I3 paid Oct 15
      { asOf: TODAY, net: 1300, pastDue: 1250 },
    ]);
  });
});
