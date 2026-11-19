import "dotenv/config";
import { defineConfig } from "prisma/config";

// The database URL is optional here so `prisma generate` (run by npm install)
// works on a machine with no database configured, such as CI's install step.
// Commands that touch the database fail clearly without one.
//
// Migrations prefer DATABASE_URL_UNPOOLED: Neon's direct connection, which
// Vercel's Neon integration sets alongside the pooled DATABASE_URL. Schema
// changes shouldn't go through a connection pooler. The app itself always
// uses DATABASE_URL (lib/db.ts).
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(url ? { datasource: { url } } : {}),
});
