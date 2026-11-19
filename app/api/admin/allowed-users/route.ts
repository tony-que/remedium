import { NextResponse } from "next/server";
import { apiGate } from "@/lib/access";
import { listAllowedUsers } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

/** The allow-list, for admins only. Changes go through the admin page's server actions. */
export async function GET() {
  const gate = await apiGate("admin");
  if (gate instanceof NextResponse) return gate;
  const users = await listAllowedUsers();
  return NextResponse.json(users.map((u) => ({ email: u.email, role: u.role, addedBy: u.addedBy, createdAt: u.createdAt })));
}
