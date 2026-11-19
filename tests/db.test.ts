import { afterAll, describe, expect, it } from "vitest";
import "dotenv/config";

// Smoke test for step 1: the app can reach the configured Postgres database.
describe("database connection", () => {
  it("answers a trivial query", async () => {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    expect(rows[0].ok).toBe(1);
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });
});
