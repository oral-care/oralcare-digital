import { createHmac } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

// The Resend webhook route end to end with the app's role (plan 11 and 17.4).

const urls = inject("databaseUrls");
const secret = `whsec_${Buffer.from("a test secret of thirty-two bytes").toString("base64")}`;
let owner: Client;

async function route(withSecret = true) {
  vi.resetModules();
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("APP_URL", "https://digital.oralcaregroup.com");
  vi.stubEnv("DATABASE_URL_APP", urls.oc_app);
  vi.stubEnv("CRON_SECRET", "0".repeat(64));
  vi.stubEnv("BETTER_AUTH_SECRET", "a-test-secret-that-is-long-enough-1234");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", withSecret ? secret : "");
  if (!withSecret) delete process.env.RESEND_WEBHOOK_SECRET;
  const handler = await import("@/app/api/webhooks/resend/route");
  const pool = await import("@/lib/db/app");
  return { POST: handler.POST, pool: pool.appPool };
}

function delivery(event: unknown, key = secret) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = Buffer.from(key.replace(/^whsec_/, ""), "base64");
  const signature = `v1,${createHmac("sha256", raw).update(`msg_1.${timestamp}.${body}`).digest("base64")}`;
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "msg_1", "svix-timestamp": timestamp, "svix-signature": signature },
    body,
  });
}

const bounced = (type: string) => ({
  type: "email.bounced",
  data: { to: ["Bounced@Example.com"], bounce: { type } },
});

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  await owner.connect();
});

beforeEach(async () => {
  await owner.query("DELETE FROM auth.email_suppression WHERE email LIKE '%@example.com'");
});

afterAll(async () => {
  await owner.query("DELETE FROM auth.email_suppression WHERE email LIKE '%@example.com'");
  await owner.end();
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/resend", () => {
  it("stops e-mail to an address after a permanent bounce, once however often it comes", async () => {
    const { POST, pool } = await route();
    expect((await POST(delivery(bounced("Permanent")))).status).toBe(200);
    expect((await POST(delivery(bounced("Permanent")))).status).toBe(200);
    expect((await owner.query("SELECT email, reason FROM auth.email_suppression")).rows).toEqual([
      { email: "bounced@example.com", reason: "bounce" },
    ]);
    await pool().end();
  });

  it("keeps sending after a temporary bounce", async () => {
    const { POST, pool } = await route();
    expect((await POST(delivery(bounced("Transient")))).status).toBe(200);
    expect((await owner.query("SELECT 1 FROM auth.email_suppression")).rowCount).toBe(0);
    await pool().end();
  });

  it("refuses a delivery signed with another secret, and waits for the secret", async () => {
    const other = `whsec_${Buffer.from("another secret, thirty-two bytes").toString("base64")}`;
    const signed = await route();
    expect((await signed.POST(delivery(bounced("Permanent"), other))).status).toBe(401);
    const unsigned = await route(false);
    expect((await unsigned.POST(delivery(bounced("Permanent")))).status).toBe(503);
    expect((await owner.query("SELECT 1 FROM auth.email_suppression")).rowCount).toBe(0);
  });
});
