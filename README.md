# Remedium Sales Dashboard

A private web app that syncs Remedium Healthcare Products' QuickBooks Online
invoices into Postgres and shows sales by SKU and by customer. The full build
spec is in [`SPEC.md`](SPEC.md).

**Status:** build step 1 of 7 (scaffold) is done. The database schema, sign-in,
QuickBooks sync and dashboard come in steps 2–6.

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

2. Create a Postgres database and a user that may create databases
   (Prisma's `migrate dev` needs that for its temporary shadow database):

   ```bash
   psql -U postgres -c "CREATE ROLE remedium WITH LOGIN PASSWORD 'remedium' CREATEDB;" -c "CREATE DATABASE remedium_dev OWNER remedium;"
   ```

3. Copy the environment template and set `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

   For the database above:
   `DATABASE_URL=postgresql://remedium:remedium@localhost:5432/remedium_dev`.
   The other variables are needed from step 3 onward.

4. Start the dev server and open http://localhost:3000:

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
| `npm test` | Vitest, once (needs `DATABASE_URL` for the database test) |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Load seed data (added in step 2) |
| `npm run db:studio` | Browse the database in Prisma Studio |

## Repo layout

```
app/           pages and api/ routes
components/    charts, tables, filters
lib/db.ts      the shared Prisma client
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
