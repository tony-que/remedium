# Microsoft sign-in (Entra ID) setup

This lets your team sign in to Remedium Cockpit with their
Microsoft 365 work accounts. You do it once, in about 15 minutes. You need to
be an admin of the **remedium-usa.com** Microsoft 365 tenant, specifically a
Global Administrator, Application Administrator or Cloud Application
Administrator.

Signing in and seeing data are separate checks. Once this is set up, anyone in
an allowed tenant can sign in, but only people on the dashboard's allow-list
(admin page → *Who can sign in*) see any data.

## Before you start

You need the app's address. Below, `<APP>` means it. Use your Vercel address
(for example `https://remedium-sales.vercel.app`) or your custom domain (for
example `https://sales.remedium-usa.com`), with no trailing slash.

Two Microsoft tenants sign in today, so the registration is **multi-tenant**,
and the app itself accepts only these two:

| Domain | Tenant id |
| --- | --- |
| remedium-usa.com | `929e6f0f-0091-439a-a7e7-8d4e530b64d7` |
| stairwayventures.com | `5500e785-513f-4ff9-b917-93a0c7e1a840` |

## Steps

### 1. Register the app

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) and
   sign in with your **remedium-usa.com** admin account.
2. Open **Identity → Applications → App registrations → New registration**.
3. Fill in:
   - **Name:** `Remedium Cockpit`
   - **Supported account types:** **Accounts in any organizational directory
     (Any Microsoft Entra ID tenant – Multitenant)**. The app turns away every
     tenant not on the list above.
   - **Redirect URI:** platform **Web**, URI
     `<APP>/api/auth/callback/microsoft-entra-id`
4. Click **Register**.

To sign in during local development too, open **Authentication** afterwards
and add a second Web redirect URI:
`http://localhost:3000/api/auth/callback/microsoft-entra-id`.

### 2. Copy the client id

On the app's **Overview** page, copy **Application (client) ID**. This becomes
`AUTH_MICROSOFT_ENTRA_ID_ID`.

### 3. Create a client secret

1. Open **Certificates & secrets → Client secrets → New client secret**.
2. Description: `Vercel production`. Expiry: the longest your policy allows
   (24 months is the maximum).
3. Click **Add**, then copy the secret's **Value** column right away. It is
   shown only once. Don't copy the *Secret ID*. The value becomes
   `AUTH_MICROSOFT_ENTRA_ID_SECRET`.
4. **Put the expiry date in your calendar.** Sign-in stops working the day
   the secret expires. To renew it, create a new secret, update Vercel and
   redeploy, then delete the old one.

Paste the value straight into Vercel (step 6). Don't send it by email or chat.

### 4. Set permissions

1. Open **API permissions**. Microsoft adds **Microsoft Graph → User.Read**
   by default. The app doesn't need it, so remove it (… → **Remove
   permission**).
2. Click **Add a permission → Microsoft Graph → Delegated permissions** and
   tick **openid**, **profile** and **email**. Click **Add permissions**.
3. Click **Grant admin consent for Remedium** and confirm. Each permission
   should show a green check under *Status*.

### 5. Include the email address in the sign-in token

1. Open **Token configuration → Add optional claim**.
2. Token type **ID**, tick **email**, click **Add**. If asked, tick *Turn on
   the Microsoft Graph email permission* and confirm.

Without this, the app uses the account's sign-in name instead, which is
usually the same address.

### 6. Add the settings to Vercel

In Vercel → your project → **Settings → Environment Variables** (Production):

| Variable | Value |
| --- | --- |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | the Application (client) ID from step 2 |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | the secret Value from step 3 |
| `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS` | `929e6f0f-0091-439a-a7e7-8d4e530b64d7,5500e785-513f-4ff9-b917-93a0c7e1a840` |

`AUTH_SECRET` and `AUTH_URL` must be set too (see DEPLOY.md). Then go to
**Deployments → … → Redeploy** so the new settings take effect.

### 7. Approve the app for stairwayventures.com

The registration lives in the Remedium tenant, so the stairwayventures.com
tenant has to approve it once. An admin of **stairwayventures.com** opens this
link (put the client id from step 2 at the end) and clicks **Accept**:

```
https://login.microsoftonline.com/5500e785-513f-4ff9-b917-93a0c7e1a840/adminconsent?client_id=<client id>
```

After accepting, Microsoft redirects to the app's sign-in callback and may
show an error page. That's expected for this link: the approval is already
saved.

## Test it

1. Open `<APP>` in a private browser window. The **Sign in with Microsoft**
   button appears once all three variables are set.
2. Sign in with your remedium-usa.com or stairwayventures.com account. If
   you're on the allow-list, you land on the dashboard.
3. Sign in with a personal Microsoft account (outlook.com and the like). It
   should be refused, because its tenant isn't on the list.
4. Ask a colleague who isn't on the allow-list to sign in. They should see
   "Ask your admin for access" and no data. Add them on the admin page and
   they'll see the dashboard on their next page load.

## Adding another company's tenant later

Look the domain's tenant id up at
`https://login.microsoftonline.com/<domain>/v2.0/.well-known/openid-configuration`.
It's the GUID inside `issuer`. Add it to
`AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS`, comma-separated, redeploy, and have
that tenant's admin open the approval link from step 7 with their tenant id in
place of `5500e785-…`.

## If something goes wrong

| What you see | What it means | Fix |
| --- | --- | --- |
| No **Sign in with Microsoft** button | One of the three variables is missing, or you didn't redeploy | Check step 6, redeploy |
| **AADSTS50011**: redirect URI mismatch | The redirect URI in step 1 doesn't match `<APP>` exactly | Compare https vs http, the domain, and a trailing slash; fix it under **Authentication** |
| **AADSTS65001** or "Need admin approval" | The person's tenant hasn't approved the app | Remedium: redo step 4's *Grant admin consent*. Stairwayventures: do step 7 |
| **AADSTS7000215**: invalid client secret | You copied the *Secret ID*, or the secret expired | Create a new secret (step 3) and copy its **Value** |
| Back on the sign-in page: "That account can't sign in here" | The tenant isn't on `AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS` | Add the tenant id and redeploy |
| "Ask your admin for access" after signing in | Sign-in worked, but the email isn't on the allow-list | An admin adds it on the admin page |
| "Sign-in is not set up correctly" | `AUTH_SECRET` or `AUTH_URL` is missing or wrong | See DEPLOY.md, section 3 |
