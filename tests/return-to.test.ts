import { describe, expect, it } from "vitest";
import { safeReturnTo, signInUrl } from "@/lib/return-to";

describe("safeReturnTo", () => {
  it.each(["/", "/admin", "/?from=2026-01-01&to=2026-11-19&customer=58", "/api/qbo/connect", "/quickbooks-disconnected"])("allows %s", (p) => {
    expect(safeReturnTo(p)).toBe(p);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/admin\nSet-Cookie: x=1",
    "/api/auth/signout",
    "/signin?callbackUrl=/",
    "",
    null,
    42,
  ])("refuses %j", (p) => {
    expect(safeReturnTo(p)).toBeNull();
  });

  it("builds a sign-in URL that comes back, and a plain one otherwise", () => {
    expect(signInUrl("/?from=2026-01-01&customer=58")).toBe("/signin?callbackUrl=%2F%3Ffrom%3D2026-01-01%26customer%3D58");
    expect(signInUrl("/")).toBe("/signin");
    expect(signInUrl("https://evil.example")).toBe("/signin");
    expect(signInUrl(null)).toBe("/signin");
  });
});
