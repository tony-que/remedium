import { NextResponse } from "next/server";
import { apiGate } from "@/lib/access";

export const dynamic = "force-dynamic";

/** The signed-in viewer's email and role. */
export async function GET() {
  const gate = await apiGate("viewer");
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ email: gate.email, role: gate.role });
}
