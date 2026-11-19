import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emailFromEntraProfile, isAllowedTenant, normalizeEmail, parseTenantList } from "@/lib/auth-rules";

// Sign-in for the dashboard.
//
// * Microsoft Entra ID, limited to the tenants in
//   AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS. Auth.js verifies each token
//   against its own tenant's keys and issuer; this file then checks the
//   tenant is on the list.
// * Email magic link (Resend), sent only to addresses on the allow-list.
// * Dev login: `next dev` only, and only with AUTH_DEV_LOGIN=true. It can
//   never run in a production build.
//
// Signing in is not the same as having access: anyone from an allowed tenant
// can sign in, but lib/access.ts checks allowed_users on every request and
// shows "Ask your admin for access" to everyone else.

const ENTRA_MULTI_TENANT_ISSUER = "https://login.microsoftonline.com/organizations/v2.0";

export const allowedTenants = parseTenantList(process.env.AUTH_MICROSOFT_ENTRA_ID_ALLOWED_TENANTS);

export const entraEnabled = Boolean(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET && allowedTenants.length > 0,
);
export const magicLinkEnabled = Boolean(process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM);
export const devLoginEnabled = process.env.NODE_ENV === "development" && process.env.AUTH_DEV_LOGIN === "true";

/** The Prisma adapter, minus Microsoft's OAuth tokens, which this app never uses. */
function adapter(): Adapter {
  // @auth/prisma-adapter is typed against the default @prisma/client output;
  // this project generates its client into lib/generated, which is the same API.
  const base = PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]);
  return {
    ...base,
    linkAccount: (account) =>
      base.linkAccount!({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        expires_at: undefined,
        session_state: undefined,
      }),
  };
}

const providers: NextAuthConfig["providers"] = [];

if (entraEnabled) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: ENTRA_MULTI_TENANT_ISSUER,
      // Name and email only: no Microsoft Graph access, no profile photo.
      authorization: { params: { scope: "openid profile email" } },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: emailFromEntraProfile(profile),
          image: null,
        };
      },
    }),
  );
}

if (magicLinkEnabled) {
  providers.push(
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM,
      maxAge: 15 * 60, // links work for 15 minutes
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email);
        return email ? { id: `dev:${email}`, email, name: email } : null;
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  adapter: adapter(),
  providers,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/signin", verifyRequest: "/signin/check-email", error: "/signin" },
  trustHost: true,
  callbacks: {
    async signIn({ user, account, profile, email }) {
      const address = normalizeEmail(user.email);
      if (!address) return false;

      if (account?.provider === "microsoft-entra-id") {
        if (!isAllowedTenant(profile?.tid, allowedTenants)) {
          await audit(address, "sign_in_denied", { reason: "tenant_not_allowed", tid: String(profile?.tid ?? "") });
          return false;
        }
      }

      if (account?.provider === "resend" && email?.verificationRequest) {
        // Only send links to people on the allow-list. Everyone else sees the
        // same "check your email" page, so the form can't be used to find out
        // who has access.
        const listed = await prisma.allowedUser.findUnique({ where: { email: address } });
        await audit(address, "magic_link_requested", { sent: Boolean(listed) });
        return listed ? true : "/signin/check-email";
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = normalizeEmail(user.email) ?? undefined;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") session.user.email = token.email;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      const address = normalizeEmail(user.email);
      if (address) await audit(address, "sign_in", { provider: account?.provider ?? "unknown" });
    },
    async signOut(message) {
      const email = "token" in message ? normalizeEmail(message.token?.email) : null;
      if (email) await audit(email, "sign_out");
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
