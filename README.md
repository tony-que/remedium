# Remedium Cockpit

A private web app that syncs Remedium Healthcare Products' QuickBooks Online
invoices into Postgres and shows sales by SKU and by customer. The full build
spec is in [`SPEC.md`](SPEC.md).

**Status:** build steps 1–6 are done and step 7 (deployment) is prepared: see
[`DEPLOY.md`](DEPLOY.md) for the Vercel, Neon, Intuit and Entra setup and the
go-live checklist. CI runs on every push (`.github/workflows/ci.yml`).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · Prisma 7 with Postgres ·
ESLint · Vitest. Every dependency is pinned to an exact version.

## Prerequisites

- Node.js 22 or newer
- **npm 11** (the version is pinned in `package.json` under `packageManager`).
  npm 10 fails to install Vitest with `Cannot read properties of null (reading 'edgesOut')`.
  Either upgrade (`npm install -g npm@11`) or run `corepack enable`.
- Postgres 16 or newer, local or hosted (Neon or Supabase)

## Run it locally

1. Install dependencies (this also generates the Prisma client):

   ```bash
   npm install
   ```

2. Create a Postgres user that may create databases (Prisma's `migrate dev`
   needs that for its temporary shadow database), a dev database and a test
   database:

   ```bash
   psql -U postgres -c "CREATE ROLE remedium WITH LOGIN PASSWORD 'remedium' CREATEDB;" -c "CREATE DATABASE remedium_dev OWNER remedium;" -c "CREATE DATABASE remedium_test OWNER remedium;" -c "CREATE DATABASE remedium_e2e OWNER remedium;"
   ```

3. Copy the environment template and set the two database URLs:

   ```bash
   cp .env.example .env
   ```

   For the databases above:
   `DATABASE_URL=postgresql://remedium:remedium@localhost:5432/remedium_dev` and
   `TEST_DATABASE_URL=postgresql://remedium:remedium@localhost:5432/remedium_test`
   (and `E2E_DATABASE_URL=…/remedium_e2e` for the smoke test).
   Also set `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_URL=http://localhost:3000`
   and `ADMIN_EMAIL` (your work email). To sign in locally before Microsoft
   sign-in is set up, add `AUTH_DEV_LOGIN=true`; see [Sign-in](#sign-in).

4. Create the tables and load the seed data:

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:seed
   ```

5. Start the dev server and open http://localhost:3000:

   ```bash
   npm run dev
   ```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Generate the Prisma client and build for production |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check with no output |
| `npm test` | Vitest, once. Applies migrations to `TEST_DATABASE_URL` first; database tests roll back their own writes |
| `npm run test:e2e` | Playwright smoke test against `next dev` and `E2E_DATABASE_URL` (reset and seeded each run) |
| `npm run db:migrate` | Create and apply a migration in development, then regenerate the Prisma client |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Load the SKU conversions and fake sales data (`-- --no-fake` for conversions only) |
| `npm run db:studio` | Browse the database in Prisma Studio |

## Data model

`prisma/schema.prisma` holds every table in SPEC.md's data model, plus
`allowed_users`, `qbo_connection` and `audit_log`. SQL that Prisma can't express
lives in `prisma/migrations/`:

- **`sales_lines` view**: the flat shape every dashboard query reads. Deleted
  invoices are left out, credit memo lines come back with negative qty, amount
  and eaches, and eaches = qty × the item's own SKU conversion (0 when a SKU has
  none, flagged by `has_conversion`).
- **Sync lock**: a unique index allows only one `sync_runs` row with
  `status = 'running'`.
- **Checks**: lowercase allow-list emails, a single `qbo_connection` row, and
  non-negative conversions.

`lib/items.ts` turns QuickBooks item names into `sku`, `category`, `base_sku`
(Amazon `-AMZ` and pack `-3PK` codes removed) and `is_product`. The admin can
override `is_product` per item, and the sync then leaves that item alone.

### Seed data

`npm run db:seed -- --no-fake` is the production bootstrap, and runs on every
Vercel deploy. It loads the CSV conversions only into an empty table and adds
`ADMIN_EMAIL` only when there is no admin, so it never undoes an admin's
changes. The rest of this section describes the local seed.

`npm run db:seed` adds `ADMIN_EMAIL` to the allow-list as an admin (it never
demotes or removes anyone) and loads the 54 conversions in
`sku_eaches_conversion.csv`. It
never overwrites a conversion that already exists, so re-running it can't undo
the admin's edits. It also loads fake sales data for local work: 6 customers, 11
items, 21 invoices (one deleted, one voided) and 2 credit memos, all with ids
starting `seed-`. Re-seeding replaces only those rows, and the fake data is
refused when `NODE_ENV=production`.

## Sign-in

Who can sign in and who can see data are separate checks:

1. **Signing in.** Microsoft work accounts from the tenants in
   `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS`, or an emailed magic link.
   Magic links are only sent to addresses on the allow-list. Anyone else gets
   the same "check your email" page, so the form can't be used to find out
   who has access.
2. **Seeing data.** Every page, server action and API route looks the email up
   in `allowed_users` on each request (`lib/access.ts`). Anyone signed in but
   not listed sees "Ask your admin for access". Removing someone takes effect
   on their next page load. Viewers get 403 from admin API routes and are
   turned away from `/admin`.

After signing in, people return to the page they asked for, so a shared
dashboard link keeps its filters. `middleware.ts` records the path, and
`lib/return-to.ts` accepts only paths on this site, so a crafted link can't
redirect anyone elsewhere.

Sessions are 12-hour signed cookies. Microsoft is asked only for name and
email: no Graph access, no profile photo, and its tokens are never stored.
Sign-ins, denied sign-ins, magic-link requests and allow-list changes go to
`audit_log`.

The admin page (`/admin`) edits the allow-list. It won't remove or demote the
last admin, and won't let an admin remove themselves.

### Microsoft Entra ID setup (once)

Full step-by-step guide with testing and troubleshooting: [`docs/ENTRA_SETUP.md`](docs/ENTRA_SETUP.md).

Two tenants sign in today, so the app registration is multi-tenant and the
app itself checks the tenant against the list:

| Domain | Tenant id |
| --- | --- |
| remedium-usa.com | `929e6f0f-0091-439a-a7e7-8d4e530b64d7` |
| stairwayventures.com | `5500e785-513f-4ff9-b917-93a0c7e1a840` |

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), signed
   in to the **remedium-usa.com** tenant, open **App registrations → New
   registration**.
   - Name: `Remedium Cockpit`
   - Supported account types: **Accounts in any organizational directory
     (Multitenant)**. The app only accepts the tenants on the list.
   - Redirect URI: **Web**,
     `https://<your app's domain>/api/auth/callback/microsoft-entra-id`.
     Add `http://localhost:3000/api/auth/callback/microsoft-entra-id` too for
     local work.
2. Copy **Application (client) ID** into `AUTH_MICROSOFT_ENTRA_ID_ID`.
3. **Certificates & secrets → New client secret.** Copy the secret's
   **Value** (not its ID) into `AUTH_MICROSOFT_ENTRA_ID_SECRET`. Note the
   expiry date: sign-in stops working when the secret expires.
4. **API permissions:** keep Microsoft Graph `openid`, `profile` and `email`
   (delegated). `User.Read` isn't needed and can be removed. Click **Grant
   admin consent for Remedium**.
5. **Token configuration → Add optional claim → ID → email.** Without it the
   app falls back to the account's sign-in name, which is usually the same.
6. For **stairwayventures.com**: an admin of that tenant opens
   `https://login.microsoftonline.com/5500e785-513f-4ff9-b917-93a0c7e1a840/adminconsent?client_id=<client id>`
   once and approves.
7. Set `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS` to both ids, comma-separated.
   To add another tenant later, look its id up at
   `https://login.microsoftonline.com/<domain>/v2.0/.well-known/openid-configuration`
   (the GUID in `issuer`).

The **Sign in with Microsoft** button appears once the client id, secret and
tenant list are all set.

### Magic-link setup (optional)

Links are sent through [Resend](https://resend.com), which will also send the
sync-failure alerts in build step 5. Create an API key, verify the sending
domain, then set `AUTH_RESEND_KEY` and `EMAIL_FROM`
(for example `Remedium Cockpit <sales@remedium-usa.com>`). The email form
appears once both are set.

### Dev login (local only)

With `AUTH_DEV_LOGIN=true`, `npm run dev` shows a form that signs you in as any
email, so the allow-list can be tried out without Microsoft. It only exists
under `next dev`: production builds never include it, even with the variable
set. The allow-list still applies, so sign in as `ADMIN_EMAIL` to reach
`/admin`.

## QuickBooks connection

The app reads QuickBooks through one company-level OAuth connection that an
admin makes once from `/admin`. Viewers never need QuickBooks access.

### Intuit app setup (once per set of keys)

1. At [developer.intuit.com](https://developer.intuit.com), create an app with
   the **Accounting** scope (`com.intuit.quickbooks.accounting`). The app only
   reads.
2. Under **Development** (sandbox) and later **Production** settings, add the
   redirect URI `https://<your app's domain>/api/qbo/callback`. Development keys
   also accept `http://localhost:3000/api/qbo/callback`.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` (exactly as
   registered) and `QBO_ENVIRONMENT` (`sandbox` or `production`). Generate
   `TOKEN_ENC_KEY` with `openssl rand -base64 32`, and keep it: tokens saved
   under one key can't be read with another, so a lost key means reconnecting.
4. Sandbox only: create a sandbox company under **Sandboxes** in the Intuit
   developer portal. Intuit lists only the companies of the account you sign
   in with.

### How it works

- **Connect** (`/api/qbo/connect`, admin only) sends the admin to Intuit with
  a random `state` value, also kept in a 10-minute HttpOnly cookie.
  **Callback** (`/api/qbo/callback`) requires the same signed-in admin and a
  matching `state` before it exchanges the code.
- Tokens are stored AES-256-GCM encrypted (`lib/qbo/crypto.ts`), each bound to
  its column, and only decrypted on the server in `lib/qbo/connection.ts`.
  They are never sent to the browser, put in an error message or logged.
- `getAccessToken()` refreshes when under 5 minutes remain, or always with
  `force` (the sync will force it before every run). It saves the rolled-forward
  refresh token each time, under a row lock so simultaneous refreshes can't
  lose it. A failed refresh keeps the old tokens and shows the error on
  `/admin`.
- Intuit's refresh tokens last about 100 days from the last refresh, so the
  nightly sync keeps the connection alive. `/admin` shows the reconnect-by date.
- **Disconnect** revokes the token at Intuit and deletes the stored connection.
- **Disconnected from inside QuickBooks:** Intuit sends the admin to
  `/quickbooks-disconnected`, which asks Intuit for a fresh token. If Intuit
  answers `invalid_grant`, the stored connection is cleared and the page
  offers Reconnect. A working connection, or an unclear failure, is left alone.
- **Connect from Intuit's side:** `/api/qbo/connect` is also Intuit's
  Connect/Reconnect URL. A visitor who isn't signed in is sent to sign-in and
  brought back.
- **Connecting a different company** (for example, moving from the sandbox to
  the real company file) clears all synced QuickBooks data and the sync
  history, so the next sync is a full backfill of the new company.
  Conversions, the allow-list and the audit log stay.
- The OAuth calls use plain `fetch` (`lib/qbo/oauth.ts`) rather than the
  `intuit-oauth` package, whose dependencies fail `npm audit` and which can log
  token responses.

Behind an HTTPS proxy (some cloud dev containers), start Node with
`NODE_USE_ENV_PROXY=1`. Node's built-in `fetch` ignores `HTTPS_PROXY`
otherwise.

## Sync

`lib/sync/run.ts` is the only code that reads invoices from QuickBooks. The
dashboard reads Postgres only.

| Run | When | What it does |
| --- | --- | --- |
| **Incremental** | Nightly, and **Refresh now** on `/admin` | Change Data Capture since the last successful run's start, less an hour of overlap: changed invoices, credit memos, items and customers, plus deletions |
| **Full** | First run, **Full re-read** on `/admin`, and automatically when needed | Re-reads everything since `SYNC_START_DATE` (default 2024-01-01), then marks documents QuickBooks no longer has as deleted |

A run switches to **full** by itself when the last success is over 30 days
old (CDC's limit), when CDC returns its 1,000-record cap for an entity, or when
CDC fails. A full re-read is used as the fallback instead of a plain "changed
since" query because such a query can't see deletions.

Rules every run follows:

- **Refreshes the token first.** This proves the connection works and keeps
  the 100-day refresh window rolling.
- **Replaces each changed document's lines** in the same transaction as the
  document, so edits never double count. An older copy that arrives after a
  newer one is ignored.
- **Fetches inactive items and customers too.** QuickBooks queries return only
  active ones unless asked, and old invoices point at retired SKUs.
- **Checks completeness before deleting.** A full re-read compares what it
  fetched with QuickBooks' own `COUNT(*)`, and fails without marking anything
  deleted if they differ.
- **Keeps any `is_product` flag the admin set by hand.**
- **Retries** HTTP 429 and 5xx with 1, 2, 4 and 8 second waits (5 tries,
  honoring `Retry-After`), and refreshes the token once on a 401.
- **One run at a time.** A unique index allows one `sync_runs` row with
  `status = 'running'`. A run still "running" after 15 minutes is marked failed
  (abandoned), so a crash can't block syncing forever.
- **Logs** every run in `sync_runs` (kind, trigger, counts, API requests, note,
  error). `/admin` shows the last 20.
- **Alerts** the admins by email at most once per streak of failures: on the
  first failure if it's a token problem (reconnecting is the only fix),
  otherwise on the second failure in a row. This needs `AUTH_RESEND_KEY` and
  `EMAIL_FROM`; until those are set, the alert is written to the server log.
- The nightly run also deletes audit-log entries older than 90 days.

### Schedule

`vercel.json` calls `/api/sync` daily at 08:00 UTC: 2 a.m. Central in winter,
3 a.m. during daylight saving time. The route needs
`Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends when
`CRON_SECRET` is set in the project, and refuses everything else with 401. To
run it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your app's domain>/api/sync
```

### Development notes

- After a schema change, restart `npm run dev`. `lib/db.ts` keeps one Prisma
  client across hot reloads, so a running dev server keeps the old client.
- Scripts that import server code need the React server condition, as Next.js
  uses: `node --conditions=react-server --import tsx script.ts`.

## Dashboard

`/` is the whole tool. Every number comes from SQL over the `sales_lines` view
(`lib/metrics/queries.ts`); the browser only formats and draws.

- **Filters** live in the URL (`from`, `to`, `measure`, `customer`, `sku`,
  `zero=exclude`, `amazon=separate`), so a link reproduces the view. Presets:
  Year to date, Last 90 days, Last year, Same period last year. Dates are
  compared with each invoice's date, and "today" is US Central.
- **Filter rules:** a customer filter narrows the SKU views, a SKU filter
  narrows the customer views, and the totals, monthly chart and grid apply
  both. Click a bar, a table row or a grid heading to filter, and click it
  again (or the chip's ✕) to clear.
- **Totals** show Sales $, Units, Eaches, Invoices and Customers, each against
  the same dates a year earlier (Feb 29 maps to Feb 28).
- **SKU views** (Top SKUs, Every SKU, the grid) show product items only, and
  their % of $ is of product dollars. A note gives the non-product dollars
  left out. Amazon variants roll up under the base SKU unless "Show Amazon
  variants separately" is on, and † marks a SKU whose units mix cases and packs.
- **Eaches** = units × each item's own SKU conversion. A banner names any
  product SKU sold in the range without one.
- **Exports:** each table, the grid, months, and every line behind the totals
  (`/api/export/{skus,customers,grid,months,lines}` with the same query
  string). Text that a spreadsheet would run as a formula is defused.
- **Admin page** additions: eaches conversions (edit, add, remove, filter to
  the 26 unconfirmed ones) and a per-item product toggle that the sync keeps.

Charts use one blue series with no legend (each card's title names the
measure), and the grid uses a one-hue blue scale with the value printed in
each cell. Gains and losses use reserved green and red, always with ▲/▼ and a
sign. Light and dark themes follow the device setting, and the layout works
from 375 px up.

**Speed** (production build, measured in a cloud container): on 3 years of
data at Remedium's volume (2,340 invoices, 14,040 lines), the server answers in
about 0.05–0.1 s and a full browser load with charts drawn takes about 0.3 s.
At 10× that volume, a full load takes about 1 s.

## Repo layout

```
app/           pages and api/ routes
components/    charts, tables, filters
lib/db.ts      the shared Prisma client
lib/items.ts   item-name parsing (SKU, category, base SKU, product flag)
lib/conversions.ts  eaches-conversion CSV parser
lib/auth.ts    Auth.js setup (Microsoft, magic link, dev login)
lib/access.ts  per-request allow-list checks for pages, actions and API routes
lib/allowlist.ts    allow-list changes and their safety rules
lib/audit.ts   audit log writes and 90-day pruning
lib/qbo/       QuickBooks config, OAuth, token encryption, connection, API client and JSON mapping
lib/sync/      sync runs (run.ts) and their database writes (store.ts)
lib/email.ts   admin alert emails through Resend
lib/metrics/   filters (URL ⇄ state, presets) and the SQL behind every metric
lib/csv.ts     CSV writing for exports
lib/reference-data.ts  admin edits to product flags and eaches conversions
components/dashboard/  filters bar, totals, charts, tables, grid
prisma/        schema, migrations and seed
tests/         Vitest tests; tests/e2e has the Playwright smoke test
```

`lib/generated/` holds the generated Prisma client. It is git-ignored and
rebuilt by `npm install` and `npm run build`.

## Secrets

`.env.example` lists every variable by name. Real values never go in the repo:
keep them in `.env` locally (git-ignored) and in the host's environment
variables in production. QuickBooks tokens are stored encrypted in the database,
never in environment variables.
