import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { qboConfigured } from "@/lib/qbo/config";
import { runInventorySync } from "@/lib/inventory/sync";

// Hourly inventory sync from QuickBooks quantity on hand, called by the host's scheduler
// (vercel.json) with "Authorization: Bearer <CRON_SECRET>". Admins use
// Refresh inventory on /admin instead.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  // Without QuickBooks keys there is nothing to do, and that isn't a failure.
  if (!qboConfigured()) return NextResponse.json({ status: "skipped", reason: "QuickBooks is not configured" });
  const r = await runInventorySync({ trigger: "cron" });
  if (r.status === "busy") return NextResponse.json({ status: "busy", runningSince: r.runningSince }, { status: 409 });
  return NextResponse.json(
    { status: r.status, runId: r.runId.toString(), skus: r.skus, note: r.note, error: r.error },
    { status: r.status === "succeeded" ? 200 : 500 },
  );
}
