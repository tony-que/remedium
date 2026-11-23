import Link from "next/link";
import { requireViewer } from "@/lib/access";
import { SignOutButton } from "@/app/sign-out-button";
import { Logo } from "@/components/logo";

// Every page in this group needs a signed-in user on the allow-list.
// (API routes and server actions check again on their own; see lib/access.ts.)
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email, role } = await requireViewer();
  return (
    <div className="min-h-screen">
      <header className="border-b border-current/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-3 font-semibold" aria-label="Remedium Cockpit home">
            <Logo className="h-7" />
            <span className="border-l border-current/20 pl-3">Cockpit</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="underline underline-offset-4 hover:opacity-80">
              Sales
            </Link>
            <Link href="/inventory" className="underline underline-offset-4 hover:opacity-80">
              Inventory
            </Link>
            {role === "admin" && (
              <Link href="/admin" className="underline underline-offset-4 hover:opacity-80">
                Admin
              </Link>
            )}
            <span className="opacity-70">{email}</span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
