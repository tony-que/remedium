# Remedium Sales Dashboard

A private web app that syncs Remedium Healthcare Products' QuickBooks Online
invoices into Postgres and shows sales by SKU and by customer. The full build
spec is in [`SPEC.md`](SPEC.md).

**Status:** build steps 1 (scaffold) and 2 (database) of 7 are done. Sign-in,
the QuickBooks connection, sync and dashboard come in steps 3–6.

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
   The other variables are needed from build step 3 onward.

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

`npm run db:seed` loads the 54 conversions in `sku_eaches_conversion.csv`. It
never overwrites a conversion that already exists, so re-running it can't undo
the admin's edits. It also loads fake sales data for local work: 6 customers, 11
items, 21 invoices (one deleted, one voided) and 2 credit memos, all with ids
starting `seed-`. Re-seeding replaces only those rows, and the fake data is
refused when `NODE_ENV=production`.

## Repo layout

```
app/           pages and api/ routes
components/    charts, tables, filters
lib/db.ts      the shared Prisma client
lib/items.ts   item-name parsing (SKU, category, base SKU, product flag)
lib/conversions.ts  eaches-conversion CSV parser
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
