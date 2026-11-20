# Sales Dashboard App — Build Spec for Claude Code

Nov 19, 2026 · Tony

## Overview and goals

Build a small, secure web app that syncs Remedium Healthcare Products' QuickBooks Online invoices into its own database and shows sales by SKU and by customer, in both units and dollars, to a named list of team members who don't need QuickBooks or Claude accounts.

This replaces a prototype Claude dashboard that queried QuickBooks live in each viewer's browser. That prototype's layout and metric definitions are the starting point; this spec keeps them and adds what a shared tool needs: its own login, a stored copy of the data, and a scheduled sync.

**Success looks like:**

- A teammate opens one URL, signs in with their work account, and sees the dashboard load in under 2 seconds.
- Numbers match QuickBooks invoice lines for the same date range to the cent.
- Data is never more than 24 hours old, and an admin can trigger a refresh on demand.
- Nobody outside the allowed list can sign in, and nobody but the admin ever touches QuickBooks credentials.

**Out of scope for v1:** writing anything back to QuickBooks, inventory, cost or margin, forecasting, and a mobile app (the web app must still work on a phone browser).

## Users and access

Only people on an allow-list can sign in, and only an admin can connect or disconnect QuickBooks.

| Role | Who | Can do |
| --- | --- | --- |
| Admin | The owner (operations) | Connect QuickBooks, trigger a sync, add and remove users, see sync logs |
| Viewer | Sales, finance and leadership invitees | View every screen, filter, export CSV |

- **Sign-in:** Microsoft single sign-on with company Microsoft 365 (Entra ID) work accounts, restricted to the company's tenant, with a fallback of an email magic link.
- **Allow-list:** an `allowed_users` table of email addresses plus roles. Anyone else who signs in sees "Ask your admin for access" and no data.
- **No per-user QuickBooks access.** The app reads QuickBooks with one company-level connection that the admin makes once. Viewers never see QuickBooks tokens or links that need a QuickBooks login.

## Data source: QuickBooks Online API

All numbers come from QuickBooks Online **Invoice** records, net of CreditMemo records, read through Intuit's Accounting API, using one OAuth 2.0 connection to the company file.

**Setup (admin, once):**

1. Create an app at developer.intuit.com with the `com.intuit.quickbooks.accounting` scope (read-only use).
2. Set the redirect URI to the app's `/api/qbo/callback` route, for both development and production keys.
3. Store the Client ID and Client Secret as server-side environment variables, never in the browser bundle.
4. The admin clicks "Connect QuickBooks" in the app's admin page. The callback saves the `realmId`, access token and refresh token, encrypted.

**Tokens:** access tokens last about an hour and refresh tokens roll forward on use. The server refreshes before every sync and saves the new refresh token each time. If a refresh fails, the sync stops, the admin gets an email, and the dashboard shows the last good data with its sync time.

**Fields used from each Invoice (credit memos carry the same fields):**

| QuickBooks field | Used as |
| --- | --- |
| `Id`, `DocNumber` | Invoice id and invoice number |
| `TxnDate` | Invoice date (drives every date filter) |
| `CustomerRef.value`, `CustomerRef.name` | Customer id and name |
| `TotalAmt`, `Balance` | Stored for reference, not used in sales totals |
| `MetaData.LastUpdatedTime` | Change tracking for syncs |
| `Line[]` where `DetailType = SalesItemLineDetail` | One row per product line |
| `Line.SalesItemLineDetail.ItemRef` | Item id and full item name, for example `Wound Care Dressings:Silicone Foam Dressings:REMSF99B` |
| `Line.SalesItemLineDetail.Qty`, `UnitPrice` | Units and price |
| `Line.Amount`, `Line.Description` | Line dollars and description |

Also pull the **Item** list (name, SKU, parent category, active flag) and the **Customer** list (display name, active flag) so names stay correct when they change in QuickBooks.

## Data model

Five tables in Postgres hold everything the dashboard reads, so no page load ever calls QuickBooks.

| Table | Key columns | Notes |
| --- | --- | --- |
| `invoices` | `qbo_id` (PK), `doc_number`, `txn_date`, `customer_qbo_id`, `total_amt`, `balance`, `last_updated_qbo`, `deleted` (bool) | One row per invoice |
| `invoice_lines` | `id` (PK), `invoice_qbo_id` (FK), `line_num`, `item_qbo_id`, `qty` (numeric), `unit_price` (numeric), `amount` (numeric), `description` | Only `SalesItemLineDetail` lines |
| `items` | `qbo_id` (PK), `full_name`, `sku`, `category`, `active` | `sku` = last segment of `full_name`; `category` = everything before it, joined with " › " |
| `customers` | `qbo_id` (PK), `display_name`, `active` | |
| `sync_runs` | `id`, `started_at`, `finished_at`, `kind` (full or incremental), `status`, `invoices_upserted`, `error` | Shown on the admin page and as "Data as of …" |

Plus `allowed_users` (email, role) and `qbo_connection` (realm id, encrypted tokens, expiry), which only the server reads.

- Store money as `numeric(14,2)` and quantities as `numeric(12,2)`, never floating point.
- Add indexes on `invoices.txn_date`, `invoice_lines.invoice_qbo_id` and `invoice_lines.item_qbo_id`.
- A database view `sales_lines` joins lines, invoices, items and customers into the flat shape the dashboard needs: date, invoice number, customer, SKU, category, description, qty, amount. It excludes deleted invoices.

**Amazon variants:** add `items.base_sku` = the SKU with any trailing `-AMZ` or ` - AMZ` and pack code (`-3PK`, `-4PK`) removed, so REMSF99B - AMZ reports as REMSF99B. SKU views group by `base_sku` by default. Pack variants count packs rather than cases, so show a small note on any grouped SKU whose units mix the two.

**Credit memos:** store them in `invoices` and `invoice_lines` with a `doc_type` column (`invoice` or `credit_memo`). The `sales_lines` view returns credit memo lines with qty and amount made negative, so every sum nets them out automatically.

**Non-product items:** add `items.is_product` (boolean). It is false for Product Partnership and Profit Share Services, Shipping, Research and Development and DISCOUNT (with or without a category), true for every other item, including items with no category such as HOMECARE MATTRESS, and the admin can flip it per item on the admin page.

**Eaches conversion:** add a `sku_conversions` table (`sku` primary key, `eaches_per_unit` integer, `updated_by`, `updated_at`). Seed it from the owner's conversion table (54 SKUs as of 2026-11-19, in `sku_eaches_conversion.csv`), and let the admin edit it on the admin page.

## Sync

A backfill loads history once, then a nightly incremental sync and an admin "Refresh now" button keep it current.

1. **Backfill:** query `SELECT * FROM Invoice WHERE TxnDate >= '<start>' ORDERBY TxnDate STARTPOSITION n MAXRESULTS 1000`, paging until a page comes back short. Start from 2024-01-01 unless the owner picks another date. Run the same query for CreditMemo, and pull all Items and Customers the same way.
2. **Nightly incremental (2:00 a.m. Central):** use the Change Data Capture endpoint (`/cdc?entities=Invoice,CreditMemo,Item,Customer&changedSince=<last success − 1 hour>`). Upsert changed invoices and replace their lines in one transaction. Mark invoices returned as `Deleted` with `deleted = true`.
3. **Refresh now:** the same incremental run, started from the admin page, with at most one run at a time (a lock row in `sync_runs`).
4. **Fallback:** if CDC fails or the last success is more than 30 days old (CDC's limit), run a query for `MetaData.LastUpdatedTime >= <last success>` instead.

**Edge cases to handle:**

- Lines of other types (subtotal, discount, description-only) are skipped. Discount and shipping that are entered as *items* stay in, as they do today.
- An edited invoice replaces all of its lines, so quantities never double count.
- Voided invoices come back with zero amounts and stay in as zero rows.
- Respect Intuit's rate limits (about 500 requests a minute per company): back off and retry on HTTP 429 with exponential delay, up to 5 tries.
- Log every run's counts and errors to `sync_runs`, and email the admin after two failed runs in a row.

## Features and screens

One dashboard page carries the whole tool, built to match the prototype, plus a small admin page.

**Dashboard (all signed-in users):**

1. **Header:** title, "Data as of <last sync time>", and one sentence written from the data, for example "REMSF99B leads with 45.7% of sales dollars; Lakeland Supplychain RDC is the largest customer at 51.3%."
2. **Filters bar:** product-line buttons (All lines, Wound Care, Skincare, Support Surfaces; see Calculations); From and To date pickers; presets for Year to date, Last 90 days, Last year and Same period last year; a Sales $ / Units / Eaches toggle; and chips showing an active customer or SKU filter, each with an ✕ to clear it. Filters live in the URL query string so a link reproduces the view.
3. **Totals cards:** Sales $, Units sold, Eaches sold, Invoices, Customers. Each shows the change against the same period last year, colored by whether it's good.
4. **By month:** a bar chart of the chosen measure, with a tooltip giving dollars and units.
5. **Top SKUs and Top customers:** horizontal bar charts of the top 12 by the chosen measure. Clicking a bar filters the rest of the page, and clicking it again clears the filter.
6. **Every SKU table:** SKU, category, description, units, eaches per unit, eaches, sales $, average price, % of $. Sortable, clickable rows, sticky header.
7. **Every customer table:** customer, units, eaches, sales $, invoices, SKUs bought, % of $. Sortable, clickable rows.
8. **SKU × customer grid (new in v1):** customers as rows and the top SKUs as columns, with cells in the chosen measure and a heat shade.
9. **Export:** a CSV download of each table and of the flat line data for the current filters.
10. **Exclude $0 lines toggle:** off by default; when on, it hides sample and replacement shipments from units.

**Admin page:** QuickBooks connection status and a Connect/Reconnect button, a Refresh now button, the last 20 sync runs, and an allow-list editor.

**Layout:** a responsive grid that works from a 375 px phone to a wide desktop, light and dark themes, and keyboard-reachable controls.

## Calculations

Every metric is computed in SQL over the `sales_lines` view for the filtered date range, so the browser only formats results.

| Metric | Definition |
| --- | --- |
| Sales $ | Sum of `amount` on product lines of non-deleted invoices with `txn_date` in range. Pre-tax. Credit memo lines dated in range are subtracted; sales receipts are not included. |
| Units | Sum of `qty` on the same lines (usually cases), net of credit memo quantities. |
| Invoices | Count of distinct invoices (not credit memos) with at least one line in the selection. |
| Customers | Count of distinct customers in the selection. |
| SKUs bought | Count of distinct SKUs per customer. |
| Average price | Sales $ ÷ Units per SKU; blank when units are 0. |
| % of $ | Row's Sales $ ÷ total Sales $ for the current selection, to one decimal. |
| Change vs last year | (This range − same dates one year earlier) ÷ same dates one year earlier. |

**Filter rules:** a customer filter narrows the SKU views, and a SKU filter narrows the customer views. Totals, the monthly chart and the grid apply both filters. Months are grouped by the invoice's calendar month in the company's time zone (US Central).

**Non-product items:** the Top SKUs chart, Every SKU table and SKU × customer grid show only lines where `is_product` is true, and their % of $ is computed over product lines only. Totals, the monthly chart and the customer views still include every line, and a note under the SKU table gives the dollars left out (for example "$270,331 in non-product items not shown").

**Product lines:** each product SKU belongs to one line by its first letters, ignoring case: REM or RH is Wound Care, SC is Skincare, and every other product SKU is Support Surfaces. Picking a line narrows every view, totals included, and leaves non-product items out of all of them. `sales_lines.product_line` holds the line (null for non-product lines).

**Eaches:** Units × the SKU's `eaches_per_unit` from `sku_conversions`, summed the same way as Units (net of credit memo quantities). A SKU with no conversion counts as 0 eaches and is named in a warning at the top of the dashboard.

## Architecture and stack

One Next.js app serves the pages and API, a scheduled sync job is the only part that calls QuickBooks, and Postgres sits between them.

```
Team browser  --sign in, view-->  Next.js app  --SQL reads-->  Postgres
                                                                  ^
Scheduler (nightly + Refresh now)  --starts-->  Sync job  --upserts--+
                                                   |
                                                   +--reads invoices-->  QuickBooks Online (Accounting API, OAuth)
```

The admin's one-time "Connect QuickBooks" step also runs through the app (OAuth redirect and callback), and the tokens it saves are used only by the sync job.

| Layer | Choice | Why |
| --- | --- | --- |
| App framework | Next.js 15 (App Router) with TypeScript | Pages and API in one codebase; Claude Code knows it well |
| UI | Tailwind CSS, shadcn/ui, Recharts | Fast to build, responsive, dark mode |
| Auth | Auth.js with Microsoft Entra ID SSO | Work accounts, no passwords to manage |
| Database | Postgres (Neon or Supabase) with Prisma | Managed, cheap, typed queries and migrations |
| QuickBooks | `intuit-oauth` for tokens; REST calls to the Accounting API | Intuit's own OAuth library; plain HTTP for queries and CDC |
| Jobs | Vercel Cron calling a secret-protected `/api/sync` route | No extra servers |
| Hosting | Vercel | Preview deploys per branch, simple env-var management |
| Tests | Vitest, plus Playwright for one end-to-end smoke test | Covers parsing, metrics and the main flow |

**Repo layout:** `app/` (pages and `api/` routes), `lib/qbo/` (OAuth, client, sync), `lib/metrics/` (SQL queries), `prisma/` (schema, migrations, seed), `components/` (charts, tables, filters), `tests/`.

## Security and compliance

Treat the data as confidential customer and pricing information: the app is private, read-only toward QuickBooks, and keeps secrets on the server.

- Every route except sign-in requires a session, and every API route checks the allow-list and role on the server.
- QuickBooks tokens are encrypted at rest (AES-256-GCM with a key from the host's secret store) and never sent to the browser or written to logs.
- Secrets live in environment variables: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `TOKEN_ENC_KEY`, `DATABASE_URL`, `AUTH_SECRET`, plus the SSO provider keys. Commit a `.env.example` with names only.
- HTTPS only, secure and HttpOnly session cookies, and CSRF protection on the admin actions.
- Request only the accounting scope, and use it only for reads.
- The data holds no patient information, only hospital and distribution-center customer names, so HIPAA rules don't apply. Confirm that before adding any patient-level data.
- Keep an audit log of sign-ins, syncs and allow-list changes for 90 days.
- Dependencies are pinned, and `npm audit` runs in CI.

## Build plan

Have Claude Code build in these seven steps, checking each one before starting the next.

1. **Scaffold:** a Next.js (TypeScript) app with Tailwind, Prisma, a Postgres database, ESLint and Vitest. Add a `README.md` with run steps and a `.env.example`.
2. **Database:** a Prisma schema for every table in the data model, the `sales_lines` view as a migration, and a seed script with about 20 fake invoices for local work, plus the SKU conversions from `sku_eaches_conversion.csv`.
3. **Auth:** Auth.js with Microsoft Entra ID SSO, the allow-list check, an admin role, and the "no access" page.
4. **QuickBooks connection:** the OAuth connect and callback routes, encrypted token storage, a token refresh helper, and an admin page showing connection status. Test against an Intuit sandbox company first.
5. **Sync:** the backfill, CDC incremental and fallback jobs, with the lock and logging. Add a cron route protected by a secret and schedule it on the host. Add the Refresh now button.
6. **Dashboard:** server-side SQL queries for each metric, then the filters bar, totals cards, charts (Recharts or D3), tables, SKU × customer grid and CSV export. Keep filters in the URL.
7. **Deploy:** production keys, the Intuit app moved to production, a domain, and a first backfill on real data. Then run the acceptance checks.

## Acceptance criteria

The build is done when every box below is ticked. The reference figures come from the Claude prototype for invoices dated 2026-01-01 to 2026-11-19, read on 2026-11-19. Later edits in QuickBooks can move them slightly, so re-run the prototype on the same day as the check.

- [ ] With credit memos excluded (as the prototype does), year to date 2026: Sales $ about $7.81M, 776 invoices, 46 customers.
- [ ] With Amazon variants shown separately, REMSF99B is the top SKU, with 22,170 units and $3,569,612.00 (about 47.4% of product dollars).
- [ ] A sandbox credit memo for 2 cases of REMSF99B lowers that SKU's units by 2 and its Sales $ by the memo amount, and leaves the invoice count unchanged.
- [ ] With the 2026-11-19 conversion table and credit memos excluded, year-to-date eaches come to about 2,459,403, and REMSF99B shows 554,250 eaches (22,170 cases × 25).
- [ ] Lakeland Supplychain RDC is the top customer, with $4,006,008.01 (about 51.3%) across 112 invoices.
- [ ] Clicking a customer filters the SKU views, and clicking a SKU filters the customer views. Totals match a hand sum of the flat CSV export.
- [ ] Editing an invoice's quantity in the QuickBooks sandbox and pressing Refresh now changes the dashboard within 1 minute, with no double counting.
- [ ] A deleted invoice drops out after the next sync.
- [ ] Someone not on the allow-list can sign in but sees no data. A viewer can't open the admin page or its API routes.
- [ ] The dashboard loads in under 2 seconds on 3 years of data, and works at 375 px wide.
- [ ] Unit tests cover the item-name parsing, every metric query and the sync's upsert and delete logic.

## Open questions

Answer these before step 1 or as Claude Code reaches them. Each has a default it will use if left blank.

- [ ] Google or Microsoft for sign-in? Decided: Microsoft.
- [ ] Who are the first viewers, and should anyone else be an admin? Default: the owner as the only admin.
- [ ] How far back should the backfill go? Default: 2024-01-01.
- [ ] Should credit memos count toward sales? Decided: yes, as negative lines on the memo's date. Sales receipts stay out unless you say otherwise.
- [ ] Should the non-product items (Product Partnership and Profit Share Services, Shipping, Research and Development, DISCOUNT) be hidden from SKU views? Decided: yes, hidden from every SKU view.
- [ ] Should the Amazon variants (for example REMSF99B - AMZ) roll up under their base SKU? Decided: yes, grouped under the base SKU by default, with an optional "Show Amazon variants separately" toggle.
- [ ] Which host and budget? Default: Vercel plus a managed Postgres (Neon or Supabase), at roughly $0 to $45 a month at this size.
- [ ] Does the app need its own domain (for example sales.remedium-usa.com)? Default: the host's free subdomain.

## Inventory dashboard

A second page, **Inventory** (`/inventory`), shows stock from the 3PL, Orderwerks, next to sales from QuickBooks.

- **Data:** an hourly cron (`/api/inventory-sync`, plus Refresh inventory now on the admin page) reads every catalog item from the Orderwerks REST API (`GET /v1/catalogs`, `GET /v1/catalog/{guid}/catalog_items`, API key and secret headers) and replaces `inventory_levels` with the stock-tracked SKUs: available (`qty_on_hand`), reserved, held, on open POs (`qty_incoming`) and backordered. Unit cost is the QuickBooks item's PurchaseCost (`items.purchase_cost`). If Orderwerks counts eaches, set `ORDERWERKS_QTY_UNIT=eaches` and the page converts to cases with `sku_conversions`.
- **Monthly usage:** the greater of the owner's uploaded usage table (`sku_usage`, admin page, CSV with `sku,monthly_usage` in cases per month) and the average cases invoiced over the last 3 full calendar months, net of credit memos.
- **Months on hand:** available ÷ monthly usage.
- **Reorder rule:** a PO takes 90 days to arrive and stock must never fall below 3 months, so a SKU is **Order now** when available + on open POs is under (3 + 90 ÷ 30.44 ≈ 5.96) months of usage. The suggested order brings it back to that level, and the order-by date is when it gets there at the current pace. **Below 3 months** means available stock alone is under the floor. **Order within 30 days** gives notice a month ahead.
- **Views:** reorder alerts, inventory value (on hand × cost) by line, and on hand by SKU, with the product-line filter and a cases/eaches toggle.
