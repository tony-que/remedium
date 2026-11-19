# Remedium Sales Dashboard

A private web app that syncs Remedium Healthcare Products' QuickBooks Online
invoices into Postgres and shows sales by SKU and by customer. The full build
spec is in [`SPEC.md`](SPEC.md).

**Status:** build steps 1–3 of 7 (scaffold, database, sign-in) are done. The
QuickBooks connection, sync and dashboard come in steps 4–6.

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
   psql -U postgres -c "CREATE ROLE remedium WITH LOGIN PASSWORD 'remedium' CREATEDB;" -c "CREATE DATABASE remedium_dev OWNER remedium;" -c "CREATE DATABASE remedium_test OWNER remedium;"
   ```

3. Copy the environment template and set the two database URLs:

   ```bash
   cp .env.example .env
   ```

   For the databases above:
   `DATABASE_URL=postgresql://remedium:remedium@localhost:5432/remedium_dev` and
   `TEST_DATABASE_URL=postgresql://remedium:remedium@localhost:5432/remedium_test`.
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

Sessions are 12-hour signed cookies. Microsoft is asked only for name and
email: no Graph access, no profile photo, and its tokens are never stored.
Sign-ins, denied sign-ins, magic-link requests and allow-list changes go to
`audit_log`.

The admin page (`/admin`) edits the allow-list. It won't remove or demote the
last admin, and won't let an admin remove themselves.

### Microsoft Entra ID setup (once)

Two tenants sign in today, so the app registration is multi-tenant and the
app itself checks the tenant against the list:

| Domain | Tenant id |
| --- | --- |
| remedium-usa.com | `929e6f0f-0091-439a-a7e7-8d4e530b64d7` |
| stairwayventures.com | `5500e785-513f-4ff9-b917-93a0c7e1a840` |

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), signed
   in to the **remedium-usa.com** tenant, open **App registrations → New
   registration**.
   - Name: `Remedium Sales Dashboard`
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
(for example `Remedium Sales <sales@remedium-usa.com>`). The email form
appears once both are set.

### Dev login (local only)

With `AUTH_DEV_LOGIN=true`, `npm run dev` shows a form that signs you in as any
email, so the allow-list can be tried out without Microsoft. It only exists
under `next dev`: production builds never include it, even with the variable
set. The allow-list still applies, so sign in as `ADMIN_EMAIL` to reach
`/admin`.

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
lib/qbo/       QuickBooks OAuth, API client and sync
lib/metrics/   SQL queries behind every metric
prisma/        schema, migrations and seed
tests/         Vitest unit tests
```

`lib/generated/` holds the generated Prisma client. It is git-ignored and
rebuilt by `npm install` and `npm run build`.

## Secrets

`.env.example` lists every variable by name. Real values never go in the repo:
keep them in `.env` locally (git-ignored) and in the host's environment
variables in production. QuickBooks tokens are stored encrypted in the database,
never in environment variables.
