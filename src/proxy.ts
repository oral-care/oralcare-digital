import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, createNonce } from "@/lib/security/csp";

// Sets the CSP with a fresh nonce on every page (plan 12), sends requests on
// another host, such as the *.vercel.app address, to APP_URL, and sends
// requests without a session cookie to the sign-in, without a database query.
// The session itself is checked by the pages. The matcher keeps the proxy away
// from cron, webhooks, auth and static files: Vercel Cron does not follow
// redirects.

// The same prefix as in src/lib/auth/auth.ts, which this file can't import.
const COOKIE_PREFIX = "oc";
const PUBLIC = ["/sign-in", "/sign-in/code"];

export function proxy(request: NextRequest): NextResponse {
  const appUrl = process.env.APP_URL;
  if (appUrl && process.env.APP_ENV === "production") {
    const canonical = new URL(appUrl);
    if (request.nextUrl.host !== canonical.host) {
      const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical);
      return NextResponse.redirect(target, 308);
    }
  }

  const path = request.nextUrl.pathname;
  if (!PUBLIC.includes(path) && !getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX })) {
    return NextResponse.redirect(new URL("/sign-in", request.url), 307);
  }

  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Signed-in pages are never stored by a browser or a proxy (plan 12).
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api/cron|api/webhooks|api/auth|api/test|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
