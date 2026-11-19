import { requireAdmin } from "@/lib/access";
import { listAllowedUsers } from "@/lib/allowlist";
import { AllowList } from "./allow-list";

export default async function AdminPage() {
  const { email } = await requireAdmin();
  const users = await listAllowedUsers();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section aria-labelledby="qbo-heading" className="flex flex-col gap-2">
        <h2 id="qbo-heading" className="text-lg font-semibold">
          QuickBooks
        </h2>
        <p className="text-sm opacity-70">Connection status and Refresh now arrive in build steps 4 and 5.</p>
      </section>

      <section aria-labelledby="users-heading" className="flex flex-col gap-3">
        <h2 id="users-heading" className="text-lg font-semibold">
          Who can sign in
        </h2>
        <p className="text-sm opacity-70">
          Only these addresses can see the dashboard. Changes take effect on the person&apos;s next page load.
        </p>
        <AllowList
          me={email}
          users={users.map((u) => ({
            email: u.email,
            role: u.role,
            addedBy: u.addedBy,
            createdAt: u.createdAt.toISOString(),
          }))}
        />
      </section>
    </main>
  );
}
