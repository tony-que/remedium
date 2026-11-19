import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { confirmDisconnected } from "@/lib/qbo/connection";

// Intuit's "Disconnect URL": where QuickBooks sends someone right after they
// disconnect this app from inside QuickBooks. Admins only (others are sent to
// sign in, or told it's for admins). Checks with Intuit and, if the access is
// really gone, clears the stored connection so the admin page is accurate.

export const dynamic = "force-dynamic";

export default async function QuickBooksDisconnectedPage() {
  const { email } = await requireAdmin();
  const result = await confirmDisconnected(email);

  const content = {
    disconnected: {
      title: "QuickBooks was disconnected",
      body: `The dashboard no longer has access to ${result.status === "disconnected" && result.companyName ? result.companyName : "the company file"}. It keeps showing the last synced data, but nightly syncs have stopped until an admin reconnects.`,
    },
    not_connected: {
      title: "QuickBooks isn't connected",
      body: "There's no QuickBooks connection right now. Reconnect to resume syncing.",
    },
    still_connected: {
      title: "QuickBooks is still connected",
      body: `Intuit still accepts the dashboard's access to ${result.status === "still_connected" && result.companyName ? result.companyName : "the company file"}, so nothing changed. If you meant to disconnect, use Disconnect on the admin page.`,
    },
    unknown: {
      title: "Couldn't check the QuickBooks connection",
      body: `Intuit didn't give a clear answer (${result.status === "unknown" ? result.error : ""}). Try Test connection on the admin page.`,
    },
  }[result.status];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">{content.title}</h1>
      <p className="text-secondary">{content.body}</p>
      <div className="flex flex-wrap gap-3">
        {result.status !== "still_connected" && (
          <a href="/api/qbo/connect" className="rounded-md bg-foreground px-4 py-2 font-medium text-background hover:opacity-90">
            Reconnect QuickBooks
          </a>
        )}
        <Link href="/admin" className="rounded-md border border-line px-4 py-2 font-medium hover:bg-foreground/5">
          Go to the admin page
        </Link>
      </div>
    </main>
  );
}
