import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

// The main flow: sign in, read the dashboard, filter by clicking, export, and
// check that someone off the allow-list sees no data.

const RANGE = "from=2026-01-01&to=2026-12-31";

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.fill("#dev-email", email);
  await page.click("text=Sign in as this email");
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

const salesCard = (page: Page) =>
  page.locator('section[aria-label="Totals"] > div', { hasText: "Sales $" }).locator("p.text-2xl");

test("admin reads, filters and exports the dashboard", async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  await page.goto(`/?${RANGE}`);

  // 2026 seed data: every line, credit memos netted, the deleted invoice left out.
  await expect(salesCard(page)).toHaveAttribute("title", "$578,365.80");
  await expect(page.locator("header p.text-secondary")).toContainText("REMSF99B leads with");
  await expect(page.getByRole("alert").filter({ hasText: "No eaches conversion" })).toContainText("REMSAMPLEKIT");

  // Clicking a customer filters the page; clicking again clears it.
  const topCustomers = page.locator("section", { has: page.locator("h2", { hasText: "Top customers" }) });
  await topCustomers.locator(".recharts-bar-rectangle").first().click();
  await expect(page).toHaveURL(/customer=seed-cust-1/);
  await expect(page.getByRole("button", { name: "Clear customer filter" })).toBeVisible();
  const filtered = await salesCard(page).getAttribute("title");
  expect(filtered).not.toBe("$578,365.80");
  await topCustomers.locator(".recharts-bar-rectangle").first().click();
  await expect(page).not.toHaveURL(/customer=/);

  // The flat CSV adds up to the Sales $ card.
  const csv = await (await page.request.get(`/api/export/lines?${RANGE}`)).text();
  const [head, ...rows] = csv.replace(/^﻿/, "").trim().split("\r\n");
  const amountCol = head.split(",").indexOf("amount");
  // Descriptions in the seed contain no commas, so a plain split is safe here.
  const cents = rows.reduce((s, r) => s + Math.round(Number(r.split(",")[amountCol]) * 100), 0);
  expect(cents).toBe(57836580);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Eaches conversions" })).toBeVisible();
});

test("someone not on the allow-list sees no data", async ({ page }) => {
  await signIn(page, "stranger@example.com");
  await page.goto(`/?${RANGE}`);
  await expect(page).toHaveURL(/\/no-access/);
  await expect(page.getByRole("heading", { name: "Ask your admin for access" })).toBeVisible();
  expect((await page.request.get(`/api/export/lines?${RANGE}`)).status()).toBe(403);
});
