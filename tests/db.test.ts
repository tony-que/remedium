import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("database connection", () => {
  it("answers a trivial query", async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    expect(rows[0].ok).toBe(1);
  });

  afterAll(() => prisma.$disconnect());
});
