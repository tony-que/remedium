import "dotenv/config";
import { defineConfig } from "@playwright/test";

// One end-to-end smoke test (tests/e2e). It runs the dev server against its
// own database (E2E_DATABASE_URL), loaded with the fake seed data, and signs
// in with the dev-only login.
const DB = process.env.E2E_DATABASE_URL;
if (!DB) throw new Error("Set E2E_DATABASE_URL to an empty Postgres database for the smoke test (see .env.example).");
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/signin`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_DEV_LOGIN: "true",
      // Keep the smoke test away from real QuickBooks and email.
      QBO_CLIENT_ID: "",
      QBO_CLIENT_SECRET: "",
      AUTH_RESEND_KEY: "",
    },
  },
});
