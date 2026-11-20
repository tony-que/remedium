# Deploying Remedium Cockpit

Production runs on **Vercel**, with **Neon Postgres** added through Vercel's
Marketplace. It goes live in two stages at the same URL:

1. **Test mode**: Intuit **sandbox** keys and the sandbox company. You can
   click through the real site before it touches real data.
2. **Production**: swap in Intuit **production** keys and reconnect to the
   Remedium company file. The app sees the company changed, clears the sandbox
   data, and the next sync backfills real history.

Every push to `main` runs CI (`.github/workflows/ci.yml`: audit, lint, types,
unit tests, build, smoke test) and deploys to Vercel. Each deploy applies
database migrations and the bootstrap seed (`npm run vercel-build`).

---

## 1. Accounts (one time)

| Account | Plan | Notes |
| --- | --- | --- |
| [Vercel](https://vercel.com) | **Pro** (~$20/month) | Vercel's Hobby plan is for personal, non-commercial use. A company tool belongs on Pro, which also allows longer sync runs. |
| Neon Postgres | Free tier is plenty | Add it from Vercel → **Storage / Marketplace → Neon**. It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used for migrations). |
| Resend (optional) | Free tier | For magic-link sign-in and sync-failure alert emails. |

## 2. Create the Vercel project

1. Vercel → **Add New → Project → Import** `tony-que/remedium`.
2. Framework: Next.js (detected). Leave the build command at its default:
   Vercel runs the `vercel-build` script, which applies migrations, runs the
   bootstrap seed, then builds.
3. Node.js version: **22.x** (Project → Settings → General).
4. Add Neon (Storage → Neon → connect to this project, all environments).
   Turn on Neon's **preview branching** so preview deployments get their own
   database branch and never migrate production.
5. Add the environment variables in section 3, then **Redeploy**.

The site's address is `https://<project>.vercel.app` until you add a domain
(section 6). Below, `<APP>` means that address.

## 3. Environment variables

Set these in Vercel → Project → Settings → **Environment Variables**, scoped to
**Production** unless noted. Generate secrets on your own computer. Never
paste them into chat, email or the repo.

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | set by the Neon integration | Neon |
| `AUTH_SECRET` | `openssl rand -base64 32` | generate |
| `AUTH_URL` | `<APP>` (e.g. `https://remedium-sales.vercel.app`) | your URL |
| `ADMIN_EMAIL` | `tony@stairwayventures.com` | the first admin; used only while there is no admin |
| `TOKEN_ENC_KEY` | `openssl rand -base64 32` | generate. **Keep a copy in your password manager**: tokens saved under one key can't be read with another, so losing it means reconnecting QuickBooks |
| `CRON_SECRET` | `openssl rand -hex 24` | generate. Vercel Cron sends it to `/api/sync` automatically |
| `SYNC_START_DATE` | `2024-01-01` | how far back the backfill goes |
| `QBO_ENVIRONMENT` | `sandbox` (stage 1), then `production` | |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | Development keys (stage 1), then Production keys | developer.intuit.com → your app → Keys & credentials |
| `QBO_REDIRECT_URI` | `<APP>/api/qbo/callback` | must match Intuit's list exactly |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | from the Entra app registration | section 5 |
| `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS` | `929e6f0f-0091-439a-a7e7-8d4e530b64d7,5500e785-513f-4ff9-b917-93a0c7e1a840` | remedium-usa.com, stairwayventures.com |
| `AUTH_RESEND_KEY`, `EMAIL_FROM` | optional | Resend |

**Never set `AUTH_DEV_LOGIN`** in Vercel. (Production builds ignore it anyway.)

**Regenerate the Intuit Development secret first.** The current one was pasted
into a chat while building, so treat it as exposed.

## 4. Intuit (QuickBooks)

**Stage 1, sandbox:** in your Intuit app's **Development** settings, add the
redirect URI `<APP>/api/qbo/callback`. Keep `http://localhost:3000/api/qbo/callback`
too for local work.

**Stage 2, production keys:** Intuit issues production keys only after the app
details and a short assessment questionnaire are complete. Start this early;
review can take a few days. Intuit will ask for:

- **Host domain:** the bare domain, no `https://` or path (e.g.
  `sales.remedium-usa.com`).
- **Launch URL** (opening the app from inside QuickBooks): `<APP>/admin`.
- **Connect/Reconnect URL:** `<APP>/api/qbo/connect`. Someone arriving from
  Intuit who isn't signed in goes to sign-in and comes straight back, and a
  non-admin sees "Admins only".
- **Disconnect URL** (where Intuit sends someone who disconnects the app from
  inside QuickBooks): `<APP>/quickbooks-disconnected`. That page checks with
  Intuit at once and, if access is really gone, clears the stored connection
  and offers Reconnect.
- **Redirect URI:** `<APP>/api/qbo/callback` under **Production** settings.
- **Privacy policy and end-user license agreement URLs.** These are Remedium's
  own legal documents; they aren't part of this app. If the company has none,
  ask whoever handles legal. Claude can draft a plain internal-use version
  for review if that helps.
- **Scope:** Accounting only. The app reads and never writes.

## 5. Microsoft sign-in (Entra ID)

Follow [`docs/ENTRA_SETUP.md`](docs/ENTRA_SETUP.md) (also summarized under README → Sign-in), with the redirect URI
`<APP>/api/auth/callback/microsoft-entra-id`. Have a stairwayventures.com
tenant admin open the admin-consent link given there once.

Sign-in works as soon as the three `AUTH_MICROSOFT_ENTRA_ID_*` variables are
set and the project is redeployed. Until then, set up Resend to sign in by
email link, since nothing else works in production.

## 6. Custom domain (optional)

Vercel → Project → **Domains** → add e.g. `sales.remedium-usa.com` and create
the CNAME record it shows at your DNS host. Then update, in this order:
`AUTH_URL` and `QBO_REDIRECT_URI` in Vercel, the redirect URIs in Intuit and
Entra, then redeploy.

---

## 7. Go live

### Stage 1: test mode (sandbox)

1. Deploy with `QBO_ENVIRONMENT=sandbox` and the Development keys.
2. Open `<APP>`, sign in, and confirm you land on the dashboard. The first
   deploy added you as admin from `ADMIN_EMAIL`.
3. `/admin` → **Connect QuickBooks** → choose the sandbox company → **Refresh
   now**. Walk through the dashboard, then invite a colleague as a viewer and
   confirm they can't open `/admin`.

### Stage 2: production

1. In Vercel set `QBO_ENVIRONMENT=production` and the Production keys, then redeploy.
2. `/admin` now says the connection was made with sandbox keys. Click
   **Reconnect QuickBooks** and sign in with a QuickBooks admin for the
   **Remedium** company file. The app clears the sandbox data.
3. Press **Refresh now**. With no sync history this runs the full backfill
   from `SYNC_START_DATE`. The run log on `/admin` shows the counts.
4. Confirm the nightly run: Vercel → Project → **Cron Jobs** lists `/api/sync`
   daily at 08:00 UTC (2 a.m. Central, 3 a.m. in daylight time). Pressing
   **Run** there runs it on demand.
5. Fix the 26 eaches conversions marked "please fill in" on `/admin`
   (filter: **Only unconfirmed**).

## 8. Acceptance checks

From SPEC.md, using invoices dated 2026-01-01 to 2026-11-19. Re-run the old
prototype on the same day for its reference figures, since later QuickBooks
edits move them slightly.

| Check | How |
| --- | --- |
| YTD Sales $ ≈ $7.81M, 776 invoices, 46 customers (prototype excluded credit memos) | Dashboard totals. They include credit memos (as decided), so compare after subtracting the credit memo total from the **lines** CSV (rows with `type` = `credit_memo`) |
| REMSF99B top SKU, 22,170 units, $3,569,612.00, ≈ 47.4% (Amazon variants separate) | Tick **Show Amazon variants separately**; same credit-memo caveat |
| Credit memo for 2 cases of REMSF99B lowers its units by 2, its $ by the memo, invoice count unchanged | Already verified in the sandbox |
| YTD eaches ≈ 2,459,403; REMSF99B 554,250 (22,170 × 25) | Eaches measure. Depends on the 26 unconfirmed conversions |
| Lakeland Supplychain RDC top customer, $4,006,008.01 (≈ 51.3%), 112 invoices | Every customer table |
| Clicking a customer filters the SKU views and vice versa; totals match a hand sum of the flat CSV | Verified on sandbox data; repeat on real data |
| Editing an invoice quantity + Refresh now updates within a minute, no double counting | Verified in the sandbox |
| A deleted invoice drops out after the next sync | Verified in the sandbox |
| Off-list person sees no data; a viewer can't open `/admin` or its API routes | Invite a test viewer; try `/admin` and `/api/admin/allowed-users` |
| Loads in under 2 s on 3 years of data; works at 375 px | Measured about 0.3 s on synthetic 3-year data; check on a phone |
| Unit tests cover item-name parsing, every metric query, sync upsert and delete | `npm test` (CI runs it on every push) |

## Troubleshooting

- **Build fails at `prisma migrate deploy`:** the Neon variables aren't
  attached to that environment (Preview vs Production).
- **"Sign-in is not set up correctly":** `AUTH_SECRET` or `AUTH_URL` is
  missing, or the Entra redirect URI doesn't match `<APP>` exactly.
- **Intuit says the redirect URI is invalid:** `QBO_REDIRECT_URI` must match
  the URI in the Intuit app's settings for that key set character for character.
- **A sync failed:** `/admin` → Sync → Notes and errors. A token error means
  reconnect. Other errors retry at the next run, and admins are emailed after
  two failures in a row once Resend is set.
