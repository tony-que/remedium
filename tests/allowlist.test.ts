import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addAllowedUser, removeAllowedUser, setRole } from "@/lib/allowlist";

// Runs against the test database (tests/setup.ts) and clears the two
// tables it touches before each test.

const ADMIN = "admin@example.com";

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.allowedUser.deleteMany();
  await prisma.allowedUser.create({ data: { email: ADMIN, role: "admin", addedBy: "test" } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.allowedUser.deleteMany();
  await prisma.$disconnect();
});

describe("allow-list", () => {
  it("adds people with a lowercase email and logs it", async () => {
    await addAllowedUser(ADMIN, " New.Person@Remedium-USA.com ", "viewer");
    const row = await prisma.allowedUser.findUnique({ where: { email: "new.person@remedium-usa.com" } });
    expect(row?.role).toBe("viewer");
    expect(row?.addedBy).toBe(ADMIN);
    const log = await prisma.auditLog.findFirst({ where: { action: "allowed_user_added" } });
    expect(log?.actor).toBe(ADMIN);
    expect(log?.detail).toEqual({ email: "new.person@remedium-usa.com", role: "viewer" });
  });

  it("rejects invalid and duplicate emails", async () => {
    await expect(addAllowedUser(ADMIN, "nope", "viewer")).rejects.toThrow(/not a valid email/);
    await expect(addAllowedUser(ADMIN, "ADMIN@example.com", "viewer")).rejects.toThrow(/already on the list/);
  });

  it("the database refuses mixed-case emails written around the helpers", async () => {
    await expect(
      prisma.allowedUser.create({ data: { email: "Mixed@Example.com", role: "viewer", addedBy: "test" } }),
    ).rejects.toThrow();
  });

  it("changes roles", async () => {
    await addAllowedUser(ADMIN, "v@example.com", "viewer");
    await setRole(ADMIN, "v@example.com", "admin");
    expect((await prisma.allowedUser.findUnique({ where: { email: "v@example.com" } }))?.role).toBe("admin");
  });

  it("never demotes or removes the last admin", async () => {
    await expect(setRole("someone@example.com", ADMIN, "viewer")).rejects.toThrow(/at least one admin/);
    await expect(removeAllowedUser("someone@example.com", ADMIN)).rejects.toThrow(/at least one admin/);
  });

  it("allows demoting an admin when another remains", async () => {
    await addAllowedUser(ADMIN, "second@example.com", "admin");
    await setRole(ADMIN, "second@example.com", "viewer");
    expect((await prisma.allowedUser.findUnique({ where: { email: "second@example.com" } }))?.role).toBe("viewer");
  });

  it("won't let you remove yourself", async () => {
    await addAllowedUser(ADMIN, "second@example.com", "admin");
    await expect(removeAllowedUser(ADMIN, "Admin@Example.com")).rejects.toThrow(/remove yourself/);
  });

  it("removes people", async () => {
    await addAllowedUser(ADMIN, "v@example.com", "viewer");
    await removeAllowedUser(ADMIN, "v@example.com");
    expect(await prisma.allowedUser.findUnique({ where: { email: "v@example.com" } })).toBeNull();
  });
});
