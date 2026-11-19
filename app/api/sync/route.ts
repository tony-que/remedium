import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync/run";

// Nightly sync, called by the host's scheduler (vercel.json) with
// "Authorization: Bearer <CRON_SECRET>". Not reachable without the secret,
// and never by a signed-in user: admins use Refresh now on /admin.

export const dynamic = "force-dynamic";
/** Seconds. A full backfill of a few thousand invoices fits well inside this. */
export const maxDuration = 300;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSync({ trigger: "cron" });
  if (result.status === "busy") {
    return NextResponse.json({ status: "busy", runningSince: result.runningSince }, { status: 409 });
  }
  return NextResponse.json(
    {
      status: result.status,
      runId: result.runId.toString(),
      kind: result.kind,
      counts: result.counts,
      note: result.note,
      error: result.error,
    },
    { status: result.status === "succeeded" ? 200 : 500 },
  );
}
