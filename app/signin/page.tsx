import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { devLoginEnabled, entraEnabled, magicLinkEnabled, signIn } from "@/lib/auth";
import { getAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "That account can't sign in here. Use your company Microsoft account, or ask your admin.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  Configuration: "Sign-in is not set up correctly. Tell your admin.",
};

async function signInWith(provider: string, formData?: FormData) {
  "use server";
  try {
    await signIn(provider, formData ?? { redirectTo: "/" });
  } catch (err) {
    // signIn redirects by throwing; only real auth errors are handled here.
    if (err instanceof AuthError) redirect(`/signin?error=${encodeURIComponent(err.type)}`);
    throw err;
  }
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const access = await getAccess();
  if (access.status !== "signed_out") redirect("/");

  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again, or ask your admin.") : null;
  const nothingConfigured = !entraEnabled && !magicLinkEnabled && !devLoginEnabled;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Remedium Sales Dashboard</h1>
        <p className="mt-1 text-sm opacity-70">Sign in with your work account.</p>
      </div>

      {message && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      {entraEnabled && (
        <form action={signInWith.bind(null, "microsoft-entra-id", undefined)}>
          <button
            type="submit"
            className="w-full rounded-md bg-[#2f2f2f] px-4 py-2.5 font-medium text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
          >
            Sign in with Microsoft
          </button>
        </form>
      )}

      {magicLinkEnabled && (
        <form action={async (fd) => { "use server"; await signInWith("resend", fd); }} className="flex flex-col gap-2">
          {entraEnabled && <p className="text-center text-xs uppercase tracking-wide opacity-60">or</p>}
          <label htmlFor="email" className="text-sm font-medium">
            Email me a sign-in link
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="rounded-md border border-current/20 bg-transparent px-3 py-2"
          />
          <input type="hidden" name="redirectTo" value="/" />
          <button type="submit" className="rounded-md border border-current/30 px-4 py-2 font-medium hover:bg-current/5">
            Send link
          </button>
        </form>
      )}

      {devLoginEnabled && (
        <form
          action={async (fd) => { "use server"; await signInWith("dev-login", fd); }}
          className="flex flex-col gap-2 rounded-md border border-dashed border-amber-500/60 p-3"
        >
          <label htmlFor="dev-email" className="text-sm font-medium">
            Dev login <span className="font-normal opacity-70">(local development only)</span>
          </label>
          <input
            id="dev-email"
            name="email"
            type="email"
            required
            className="rounded-md border border-current/20 bg-transparent px-3 py-2"
          />
          <input type="hidden" name="redirectTo" value="/" />
          <button type="submit" className="rounded-md border border-current/30 px-4 py-2 font-medium hover:bg-current/5">
            Sign in as this email
          </button>
        </form>
      )}

      {nothingConfigured && (
        <p className="text-sm opacity-70">
          No sign-in method is configured. Set the Microsoft Entra ID or Resend variables in <code>.env</code> (see
          README).
        </p>
      )}
    </main>
  );
}
