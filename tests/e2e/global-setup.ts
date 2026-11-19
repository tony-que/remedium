import { execSync } from "node:child_process";
import "dotenv/config";

export const E2E_ADMIN = "e2e-admin@example.com";

// Fresh schema and the fake seed data (21 invoices, 2 credit memos) in the e2e database.
export default function setup() {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, ADMIN_EMAIL: E2E_ADMIN, NODE_ENV: "development" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync(
    `psql "${process.env.E2E_DATABASE_URL}" -q -c "TRUNCATE invoice_lines, invoices, items, customers, sku_conversions, allowed_users, sync_runs, audit_log RESTART IDENTITY CASCADE"`,
    { env, stdio: "pipe" },
  );
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
