import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { SignOutButton } from "@/app/sign-out-button";

export const dynamic = "force-dynamic";

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const access = await getAccess();
  if (access.status === "signed_out") redirect("/signin");
  const { need } = await searchParams;
  const needsAdmin = need === "admin" && access.status === "ok";
  if (access.status === "ok" && !needsAdmin) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">{needsAdmin ? "Admins only" : "Ask your admin for access"}</h1>
      <p className="opacity-80">
        {needsAdmin ? (
          <>That page is for admins. Your account can view the dashboard.</>
        ) : (
          <>
            You&apos;re signed in as <strong>{access.email}</strong>, but that address isn&apos;t on the list of people
            who can see this dashboard. Ask your admin to add it.
          </>
        )}
      </p>
      <div className="flex items-center gap-4">
        {needsAdmin && (
          <Link href="/" className="text-sm underline underline-offset-4">
            Go to the dashboard
          </Link>
        )}
        <SignOutButton />
      </div>
    </main>
  );
}
