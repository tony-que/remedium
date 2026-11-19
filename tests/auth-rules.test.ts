import { describe, expect, it } from "vitest";
import { emailFromEntraProfile, isAllowedTenant, normalizeEmail, parseTenantList } from "@/lib/auth-rules";

const REMEDIUM = "929e6f0f-0091-439a-a7e7-8d4e530b64d7";
const STAIRWAY = "5500e785-513f-4ff9-b917-93a0c7e1a840";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Tony@StairwayVentures.com ")).toBe("tony@stairwayventures.com");
  });
  it.each([undefined, null, 42, "", "no-at-sign", "a@b", "two@@x.com", "sp ace@x.com"])("rejects %s", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
});

describe("parseTenantList", () => {
  it("parses a comma-separated list of tenant ids", () => {
    expect(parseTenantList(` ${REMEDIUM}, ${STAIRWAY.toUpperCase()} ,`)).toEqual([REMEDIUM, STAIRWAY]);
  });
  it("is empty when unset", () => {
    expect(parseTenantList(undefined)).toEqual([]);
    expect(parseTenantList("")).toEqual([]);
  });
  it("rejects a domain, because tokens carry tenant ids", () => {
    expect(() => parseTenantList("remedium-usa.com")).toThrow(/not a tenant id/);
  });
});

describe("isAllowedTenant", () => {
  const allowed = [REMEDIUM, STAIRWAY];
  it("accepts listed tenants in any case", () => {
    expect(isAllowedTenant(REMEDIUM, allowed)).toBe(true);
    expect(isAllowedTenant(STAIRWAY.toUpperCase(), allowed)).toBe(true);
  });
  it("rejects other tenants and missing claims", () => {
    expect(isAllowedTenant("9188040d-6c67-4c5b-b112-36a304b66dad", allowed)).toBe(false); // personal Microsoft accounts
    expect(isAllowedTenant(undefined, allowed)).toBe(false);
    expect(isAllowedTenant(REMEDIUM, [])).toBe(false);
  });
});

describe("emailFromEntraProfile", () => {
  it("prefers the email claim", () => {
    expect(emailFromEntraProfile({ email: "A@remedium-usa.com", preferred_username: "b@remedium-usa.com" })).toBe(
      "a@remedium-usa.com",
    );
  });
  it("falls back to preferred_username", () => {
    expect(emailFromEntraProfile({ preferred_username: "B@Remedium-USA.com" })).toBe("b@remedium-usa.com");
  });
  it("returns null when neither is an email", () => {
    expect(emailFromEntraProfile({ preferred_username: "not-an-email" })).toBeNull();
  });
});
