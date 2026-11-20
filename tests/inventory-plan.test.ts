import { describe, expect, it } from "vitest";
import { addDaysYmd, lastThreeFullMonths, LEAD_TIME_MONTHS, plan, REORDER_MONTHS, type PlanInput } from "@/lib/inventory/plan";

const base: PlanInput = { available: 0, reserved: 0, held: 0, incoming: 0, providedUsage: null, soldLast3Months: 0, unitCost: null };

describe("ordering rule", () => {
  it("is 90 days of lead time plus a 3-month floor", () => {
    expect(LEAD_TIME_MONTHS).toBeCloseTo(90 / 30.4375, 6);
    expect(REORDER_MONTHS).toBeCloseTo(3 + 90 / 30.4375, 6);
  });
});

describe("plan", () => {
  it("uses the greater of provided usage and the last 3 months' average", () => {
    expect(plan({ ...base, available: 600, providedUsage: 100, soldLast3Months: 450 })).toMatchObject({ monthlyUsage: 150, usageSource: "sales", avgLast3Months: 150 });
    expect(plan({ ...base, available: 600, providedUsage: 200, soldLast3Months: 450 })).toMatchObject({ monthlyUsage: 200, usageSource: "provided" });
  });

  it("computes months on hand from available stock", () => {
    const p = plan({ ...base, available: 800, reserved: 50, incoming: 400, soldLast3Months: 300 });
    expect(p.monthlyUsage).toBe(100);
    expect(p.monthsOnHand).toBe(8);
    expect(p.monthsWithIncoming).toBe(12);
    expect(p.onHand).toBe(850);
    expect(p.status).toBe("ok");
    expect(p.suggestedOrder).toBe(0);
  });

  it("asks for an order once stock plus open POs drops under about 6 months, sized back up to that", () => {
    // usage 100/month: reorder point ≈ 595.7 cases
    const p = plan({ ...base, available: 400, incoming: 100, providedUsage: 100 });
    expect(p.status).toBe("order_now");
    expect(p.reorderPoint).toBeCloseTo(REORDER_MONTHS * 100, 6);
    expect(p.suggestedOrder).toBe(Math.ceil(REORDER_MONTHS * 100 - 500));
    expect(p.orderInDays).toBe(0);
  });

  it("flags stock under the 3-month floor even when POs are on the way", () => {
    expect(plan({ ...base, available: 250, incoming: 1000, providedUsage: 100 }).status).toBe("below_floor");
  });

  it("warns 30 days ahead, and gives the order-by day", () => {
    // 620 cases at 100/month reaches the reorder point in (620 - 595.7)/100 months ≈ 7 days
    const soon = plan({ ...base, available: 620, providedUsage: 100 });
    expect(soon.status).toBe("order_soon");
    expect(soon.orderInDays).toBe(Math.floor(((620 - REORDER_MONTHS * 100) / 100) * (365.25 / 12)));
    expect(plan({ ...base, available: 1000, providedUsage: 100 }).status).toBe("ok");
  });

  it("values every unit on the shelf at QuickBooks cost", () => {
    expect(plan({ ...base, available: 10, reserved: 5, held: 1, unitCost: 2.5 }).value).toBe(40);
    expect(plan({ ...base, available: 10 }).value).toBeNull();
  });

  it("has no ordering advice for a SKU with no usage", () => {
    expect(plan({ ...base, available: 10 })).toMatchObject({ status: "no_usage", monthsOnHand: null, suggestedOrder: 0, orderInDays: null });
  });
});

describe("dates", () => {
  it("takes the last 3 full calendar months", () => {
    expect(lastThreeFullMonths("2026-11-20")).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(lastThreeFullMonths("2026-02-01")).toEqual({ from: "2025-11-01", to: "2026-01-31" });
  });

  it("adds days across a month end", () => {
    expect(addDaysYmd("2026-11-20", 15)).toBe("2026-12-05");
  });
});
