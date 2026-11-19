import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteConversion, parseEaches, productSkusWithoutConversion, setConversion, setItemProduct } from "@/lib/reference-data";

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE items, sku_conversions, audit_log RESTART IDENTITY CASCADE`;
  await prisma.item.createMany({
    data: [
      { qboId: "1", fullName: "Freight:Shipping", sku: "Shipping", category: "Freight", baseSku: "Shipping", isProduct: false },
      { qboId: "2", fullName: "Wound Care:REMSF99B", sku: "REMSF99B", category: "Wound Care", baseSku: "REMSF99B", isProduct: true },
      { qboId: "3", fullName: "Wound Care:RHCFGA45", sku: "RHCFGA45", category: "Wound Care", baseSku: "RHCFGA45", isProduct: true },
    ],
  });
  await prisma.skuConversion.create({ data: { sku: "RHCFGA45", eachesPerUnit: 400, note: "please fill in", updatedBy: "seed" } });
});

afterAll(async () => {
  await prisma.$executeRaw`TRUNCATE items, sku_conversions, audit_log RESTART IDENTITY CASCADE`;
  await prisma.$disconnect();
});

describe("item product flags", () => {
  it("sets a flag by hand and marks it so the sync keeps it", async () => {
    await setItemProduct("admin@example.com", "1", true);
    expect(await prisma.item.findUnique({ where: { qboId: "1" } })).toMatchObject({ isProduct: true, isProductSetByAdmin: true });
  });

  it("goes back to the automatic rule", async () => {
    await setItemProduct("admin@example.com", "1", true);
    await setItemProduct("admin@example.com", "1", null);
    expect(await prisma.item.findUnique({ where: { qboId: "1" } })).toMatchObject({ isProduct: false, isProductSetByAdmin: false });
    expect(await prisma.auditLog.count({ where: { action: "item_product_set" } })).toBe(2);
  });
});

describe("eaches conversions", () => {
  it("updates a value, records who, and clears the 'please fill in' note", async () => {
    const r = await setConversion("admin@example.com", " RHCFGA45 ", "500");
    expect(r).toEqual({ sku: "RHCFGA45", eachesPerUnit: 500, previous: 400 });
    expect(await prisma.skuConversion.findUnique({ where: { sku: "RHCFGA45" } })).toMatchObject({ eachesPerUnit: 500, note: null, updatedBy: "admin@example.com" });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "conversion_set" } });
    expect(log.detail).toEqual({ sku: "RHCFGA45", eachesPerUnit: 500, previous: 400 });
  });

  it("adds a new SKU and lists product SKUs still missing one", async () => {
    expect(await productSkusWithoutConversion()).toEqual(["REMSF99B"]);
    await setConversion("admin@example.com", "REMSF99B", 25);
    expect(await productSkusWithoutConversion()).toEqual([]);
  });

  it.each(["", "2.5", "-1", "abc", "1234567"])("rejects %j", (v) => {
    expect(() => parseEaches(v)).toThrow(/whole number/);
  });

  it("deletes a conversion", async () => {
    await deleteConversion("admin@example.com", "RHCFGA45");
    expect(await prisma.skuConversion.count()).toBe(0);
    await expect(deleteConversion("admin@example.com", "RHCFGA45")).rejects.toThrow(/has no conversion/);
  });
});
