import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, createNonce } from "@/lib/security/csp";

// Sets the CSP with a fresh nonce on every page (plan 12) and sends requests on
// another host, such as the *.vercel.app address, to APP_URL. The matcher keeps
// the proxy away from cron, webhooks, auth and static files: Vercel Cron does not
// follow redirects.
export function proxy(request: NextRequest): NextResponse {
  const appUrl = process.env.APP_URL;
  if (appUrl && process.env.APP_ENV === "production") {
    const canonical = new URL(appUrl);
    if (request.nextUrl.host !== canonical.host) {
      const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical);
      return NextResponse.redirect(target, 308);
    }
  }

  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api/cron|api/webhooks|api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
