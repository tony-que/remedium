import { NextResponse, type NextRequest } from "next/server";
import { RETURN_TO_HEADER } from "@/lib/return-to";

// Records which page was asked for, so a sign-in redirect can come back to it
// (a shared dashboard link keeps its filters). It only copies the path onto
// the request; it doesn't decide access, which lib/access.ts does on the server.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(RETURN_TO_HEADER, req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not static files, images or Auth.js's own routes.
  matcher: ["/((?!_next/|api/|favicon.ico).*)"],
};
