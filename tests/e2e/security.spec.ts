import { expect, test } from "@playwright/test";

// The security checks (plan 15.4) against the built app.

const HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
};

test("every route has the security headers, pages a CSP with a nonce and /api the strictest CSP", async ({
  request,
}) => {
  const page = await request.get("/sign-in");
  expect(page.status()).toBe(200);
  for (const [name, value] of Object.entries(HEADERS)) expect(page.headers()[name], name).toBe(value);
  expect(page.headers()["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(page.headers()["cache-control"]).toContain("no-store");

  const api = await request.get("/api/auth/get-session");
  for (const [name, value] of Object.entries(HEADERS)) expect(api.headers()[name], name).toBe(value);
  expect(api.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
});

test("only the four Better Auth endpoints the app uses answer, with the right method", async ({
  request,
}) => {
  expect((await request.get("/api/auth/get-session")).status()).toBe(200);
  for (const [method, path] of [
    ["GET", "/api/auth/sign-in/email-otp"],
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/email-otp/check-verification-otp"],
    ["GET", "/api/auth/ok"],
  ] as const) {
    const response = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }
});

test("the cron routes refuse calls without the secret and are never redirected", async ({ request }) => {
  for (const path of ["/api/cron/availability/se", "/api/cron/guard"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(401);
  }
});

test("pages without a session cookie go to the sign-in", async ({ request }) => {
  for (const path of ["/", "/se", "/se/availability", "/se/admin/users", "/sign-in/market", "/no-access"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toMatch(/\/sign-in$/);
  }
});

test("crawlers may fetch the pages and are told not to index them", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  const text = await robots.text();
  expect(text).toMatch(/Allow: \//);
  expect(text).not.toMatch(/Disallow/);
  expect(robots.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const page = await request.get("/sign-in");
  expect(await page.text()).toContain('<meta name="robots" content="noindex, nofollow"/>');
});

test("the test inbox only answers known addresses", async ({ request }) => {
  expect((await request.get("/api/test/inbox?address=nobody@oralcare.se")).status()).toBe(404);
});
