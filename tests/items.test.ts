import { describe, expect, it } from "vitest";
import { baseSkuOf, parseItemName, productLineOf } from "@/lib/items";

describe("parseItemName", () => {
  it("splits SKU and category from a nested name", () => {
    const p = parseItemName("Wound Care Dressings:Silicone Foam Dressings:REMSF99B");
    expect(p.sku).toBe("REMSF99B");
    expect(p.category).toBe("Wound Care Dressings › Silicone Foam Dressings");
    expect(p.baseSku).toBe("REMSF99B");
    expect(p.isProduct).toBe(true);
    expect(p.isAmazonVariant).toBe(false);
    expect(p.isPackVariant).toBe(false);
  });

  it("handles a single category level", () => {
    const p = parseItemName("Skin Care:SCAF1204");
    expect(p.sku).toBe("SCAF1204");
    expect(p.category).toBe("Skin Care");
  });

  it("trims spaces around segments", () => {
    const p = parseItemName(" Wound Care : REMSF99B - AMZ ");
    expect(p.sku).toBe("REMSF99B - AMZ");
    expect(p.category).toBe("Wound Care");
    expect(p.baseSku).toBe("REMSF99B");
  });

  it("treats an item with no category as non-product", () => {
    const p = parseItemName("REMSF99B");
    expect(p.category).toBeNull();
    expect(p.sku).toBe("REMSF99B");
    expect(p.isProduct).toBe(false);
  });

  it.each([
    "Product Partnership and Profit Share Services",
    "Shipping",
    "Research and Development",
    "DISCOUNT",
    "discount",
  ])("flags %s as non-product even inside a category", (name) => {
    expect(parseItemName(`Services:${name}`).isProduct).toBe(false);
  });
});

describe("baseSkuOf", () => {
  it.each([
    ["REMSF99B", "REMSF99B", false, false],
    ["REMSF99B - AMZ", "REMSF99B", true, false],
    ["REMSF44B-AMZ", "REMSF44B", true, false],
    ["SCAF1003-3PK-AMZ", "SCAF1003", true, true],
    ["SCAF1204-4PK-AMZ", "SCAF1204", true, true],
    ["SCFC0404-3PK", "SCFC0404", false, true],
    ["HOMECARE MATTRESS-AMZ", "HOMECARE MATTRESS", true, false],
    ["remsf99b - amz", "remsf99b", true, false],
  ])("%s → %s", (sku, base, amazon, pack) => {
    expect(baseSkuOf(sku)).toEqual({ baseSku: base, isAmazonVariant: amazon, isPackVariant: pack });
  });

  it("does not touch AMZ or PK in the middle of a SKU", () => {
    expect(baseSkuOf("AMZ-PKG100").baseSku).toBe("AMZ-PKG100");
  });

  it("never reduces a SKU to an empty string", () => {
    expect(baseSkuOf("-AMZ").baseSku).toBe("-AMZ");
  });
});

describe("productLineOf", () => {
  it.each([
    ["REMSF99B", "wound"],
    ["REMSF99B - AMZ", "wound"],
    ["RHCFGA45", "wound"],
    ["rhcfga22", "wound"],
    ["SCAF1003", "skin"],
    ["SCFC0404-3PK-AMZ", "skin"],
    ["SCZP1004", "skin"],
    ["HOMECARE MATTRESS", "support"],
    ["HOMECARE MATTRESS-AMZ", "support"],
  ] as const)("puts %s in %s", (sku, line) => {
    expect(productLineOf(sku)).toBe(line);
  });
});
