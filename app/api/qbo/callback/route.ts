import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getQboConfig } from "@/lib/qbo/config";
import { exchangeCode, QboOAuthError } from "@/lib/qbo/oauth";
import { fetchCompanyName, saveConnection } from "@/lib/qbo/connection";
import { STATE_COOKIE, statesMatch } from "@/lib/qbo/state";

export const dynamic = "force-dynamic";

/** Intuit redirects here after the admin approves (or declines) the connection. */
export async function GET(req: NextRequest) {
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/admin?qbo=${result}`, req.url));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/qbo" });
    return res;
  };

  // The person finishing the flow must be a signed-in admin, as when it started.
  const access = await getAccess();
  if (access.status === "signed_out") return NextResponse.redirect(new URL("/signin", req.url));
  if (access.status !== "ok" || access.role !== "admin") {
    return NextResponse.redirect(new URL("/no-access?need=admin", req.url));
  }
  const actor = access.email;

  const params = req.nextUrl.searchParams;
  if (!statesMatch(req.cookies.get(STATE_COOKIE)?.value, params.get("state"))) {
    await audit(actor, "qbo_connect_failed", { reason: "state_mismatch" });
    return back("state_mismatch");
  }

  const error = params.get("error");
  if (error) {
    await audit(actor, "qbo_connect_failed", { reason: error });
    return back(error === "access_denied" ? "denied" : "error");
  }

  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || !realmId || !/^\d+$/.test(realmId)) {
    await audit(actor, "qbo_connect_failed", { reason: "missing_code_or_realm" });
    return back("error");
  }

  try {
    const config = getQboConfig();
    const tokens = await exchangeCode(config, code);
    let companyName: string | null = null;
    try {
      companyName = await fetchCompanyName(config.apiBase, realmId, tokens.accessToken);
    } catch (err) {
      // The connection still works without a name; Test connection retries it.
      console.error("CompanyInfo lookup failed after connecting:", err instanceof Error ? err.message : err);
    }
    await saveConnection(actor, realmId, config.environment, tokens, companyName);
    return back("connected");
  } catch (err) {
    const reason = err instanceof QboOAuthError ? (err.code ?? `http_${err.status}`) : "exception";
    console.error("QuickBooks connect failed:", err instanceof Error ? err.message : err);
    await audit(actor, "qbo_connect_failed", { reason });
    return back("error");
  }
}
