import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { runGuard } from "@/jobs/guard/run";
import { rightsDifferences } from "@/jobs/guard/rights";
import { ALERT_EMAILS_PER_DAY, sendPendingAlerts } from "@/jobs/runtime/alert-mail";
import type { JobEnv } from "@/jobs/runtime/env";
import type { Fetcher } from "@/jobs/runtime/http";

// The alert outbox and the guard against Postgres with their own roles, and
// a fake Resend that records what would have been sent (plan 8 and 9).

const urls = inject("databaseUrls");
const env: JobEnv = {
  CRON_SECRET: "0".repeat(64),
  DATABASE_URL_COLLECTOR: urls.oc_collector,
  DATABASE_URL_APP: urls.oc_app,
  RESEND_API_KEY: "re_test_0000000000000000",
};
const ADMIN = "guard-admin@example.com";

type Sent = { key: string; emails: { to: string[]; subject: string; html: string }[] };
let sent: Sent[] = [];
let resendStatus = 200;
const resend: Fetcher = async (_url, init) => {
  const headers = new Headers(init.headers);
  sent.push({
    key: headers.get("Idempotency-Key") ?? "",
    emails: JSON.parse(String(init.body)) as Sent["emails"],
  });
  return new Response("{}", { status: resendStatus });
};

let owner: Client;
let collector: Client;

async function pendingAlert(type: string, key: string, payload: Record<string, unknown> = {}) {
  await owner.query("INSERT INTO core.alert (dedupe_key, type, payload) VALUES ($1, $2, $3)", [
    key,
    type,
    payload,
  ]);
}

const rows = async <T>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  collector = new Client({ connectionString: urls.oc_collector });
  await owner.connect();
  await collector.connect();
});

beforeEach(async () => {
  // Other test files share the database.
  await owner.query(
    "TRUNCATE core.job_run, core.alert, core.email_send, auth.users, auth.verifications, auth.login_throttle, auth.audit_event CASCADE",
  );
  await owner.query(
    `INSERT INTO auth.users (id, name, email, first_name, last_name, role, last_sign_in_at)
     VALUES ('guard-admin', 'Alex Example', $1, 'Alex', 'Example', 'admin', now()),
            ('guard-viewer', 'Sam Example', 'guard-sam@example.com', 'Sam', 'Example', 'viewer', now())`,
    [ADMIN],
  );
  sent = [];
  resendStatus = 200;
});

afterAll(async () => {
  await owner.query("TRUNCATE core.alert, core.email_send CASCADE");
  await owner.query("DELETE FROM auth.users WHERE id LIKE 'guard-%'");
  await collector.end();
  await owner.end();
});

describe("the alert outbox", () => {
  it("sends every pending alert in one e-mail per admin, at most 3 e-mails a day", async () => {
    const now = new Date("2026-11-03T07:10:00Z");
    for (let email = 1; email <= ALERT_EMAILS_PER_DAY; email++) {
      await pendingAlert("incident", `incident-${email}`, { percent: 40 });
      await pendingAlert("window_anomaly", `window-${email}`, { clinics: 3 });
      expect(
        await sendPendingAlerts(collector, { apiKey: env.RESEND_API_KEY, now, fetcher: resend }),
      ).toMatchObject({
        status: "sent",
        alerts: 2,
      });
      now.setTime(now.getTime() + 2 * 60 * 60_000);
    }
    expect(sent).toHaveLength(3);
    expect(sent[0]!.emails.map((e) => e.to)).toEqual([[ADMIN]]);
    expect(sent[0]!.emails[0]!.subject).toBe(
      "oralcare.se showed no slots for 40% of clinics and treatments, and 1 more alert",
    );
    expect(sent[0]!.key).toMatch(/^alerts-[0-9a-f]{40}$/);

    // The fourth waits for the daily summary.
    await pendingAlert("incident", "incident-4", { percent: 40 });
    expect(await sendPendingAlerts(collector, { apiKey: env.RESEND_API_KEY, now, fetcher: resend })).toEqual({
      status: "capped",
      waiting: 1,
    });
    expect(await rows("SELECT status FROM core.alert WHERE dedupe_key = 'incident-4'")).toEqual([
      { status: "pending" },
    ]);
    expect(await rows("SELECT count::int FROM core.email_send WHERE type = 'alert'")).toEqual([{ count: 3 }]);
  });

  it("marks alerts failed when Resend refuses, and sends them again later with the same key", async () => {
    const now = new Date("2026-11-04T07:10:00Z");
    await pendingAlert("incident", "incident-x", { percent: 50 });
    resendStatus = 500;
    expect(
      await sendPendingAlerts(collector, { apiKey: env.RESEND_API_KEY, now, fetcher: resend }),
    ).toMatchObject({
      status: "failed",
      code: "resend_500",
    });
    expect(await rows("SELECT status, attempts, last_error_code FROM core.alert")).toEqual([
      { status: "failed", attempts: 1, last_error_code: "resend_500" },
    ]);
    resendStatus = 200;
    await sendPendingAlerts(collector, { apiKey: env.RESEND_API_KEY, now, fetcher: resend });
    expect(sent[1]!.key).toBe(sent[0]!.key);
    expect(await rows("SELECT status, sent_with FROM core.alert")).toEqual([
      { status: "sent", sent_with: "alert" },
    ]);
  });

  it("leaves alerts pending until there is an API key", async () => {
    await pendingAlert("incident", "incident-y", { percent: 50 });
    expect(
      await sendPendingAlerts(collector, {
        apiKey: undefined,
        now: new Date("2026-11-04T07:10:00Z"),
        fetcher: resend,
      }),
    ).toMatchObject({ status: "skipped", reason: "no_api_key" });
    expect(sent).toHaveLength(0);
  });
});

describe("the guard", () => {
  it("finds nothing wrong with the roles' rights after the migrations", async () => {
    expect(await rightsDifferences(owner)).toEqual([]);
  });

  it("checks yesterday, sends the summary with what needs attention, and prunes", async () => {
    await pendingAlert("slots_not_online", "overflow", {
      clinic: "Example Clinic",
      treatment: "Akut",
      slots: 4,
    });
    const outcome = await runGuard({
      now: new Date("2026-11-05T09:15:00Z"),
      env,
      deps: { mailFetcher: resend },
    });
    expect(outcome).toMatchObject({ status: "succeeded" });

    // The overflow alert first goes out in an alert e-mail; the summary has the guard's findings.
    expect(sent.map((s) => s.key.replace(/-[0-9a-f]{40}$/, ""))).toEqual(["alerts", "summary-2026-11-04"]);
    const summary = sent[1]!.emails[0]!;
    expect(summary.subject).toBe("Oral Care Digital, Wed 4 Nov: 9 measurements are missing");
    expect(summary.html).toContain("No backup has finished yet");
    expect(summary.html).toContain("9 measurements are missing");
    expect(summary.html).not.toContain("unexpected rights");

    const alerts = await rows<{ type: string; status: string; sent_with: string }>(
      "SELECT type, status, sent_with FROM core.alert ORDER BY type",
    );
    expect(alerts).toEqual([
      { type: "backup_old", status: "sent", sent_with: "summary" },
      { type: "missing_measurements", status: "sent", sent_with: "summary" },
      { type: "slots_not_online", status: "sent", sent_with: "alert" },
    ]);
    const [log] = await rows<{ status: string; details: Record<string, unknown> }>(
      "SELECT status, details FROM core.job_run WHERE job = 'guard'",
    );
    expect(log).toMatchObject({
      status: "succeeded",
      details: { day: "2026-11-04", summary: "sent", attention: 2 },
    });
  });

  it("logs a failed summary so the call at 10 sends it, with the same key", async () => {
    resendStatus = 500;
    expect(
      await runGuard({ now: new Date("2026-11-06T09:15:00Z"), env, deps: { mailFetcher: resend } }),
    ).toMatchObject({
      status: "failed",
    });
    resendStatus = 200;
    expect(
      await runGuard({ now: new Date("2026-11-06T10:15:00Z"), env, deps: { mailFetcher: resend } }),
    ).toMatchObject({
      status: "succeeded",
    });
    const keys = sent.map((s) => s.key);
    expect(keys).toEqual(["summary-2026-11-05", "summary-2026-11-05"]);
    expect(await rows("SELECT status, is_retry FROM core.job_run WHERE job = 'guard' ORDER BY id")).toEqual([
      { status: "failed", is_retry: false },
      { status: "succeeded", is_retry: true },
    ]);
  });

  it("names an admin who hasn't signed in for 12 months only in the e-mail, never in the alert", async () => {
    await owner.query(
      "UPDATE auth.users SET last_sign_in_at = now() - interval '13 months' WHERE id = 'guard-admin'",
    );
    const now = new Date(Date.now());
    now.setUTCHours(9, 15, 0, 0);
    expect(await runGuard({ now, env, deps: { mailFetcher: resend } })).toMatchObject({
      status: "succeeded",
    });
    const summary = sent.find((s) => s.key.startsWith("summary-"));
    expect(summary?.emails[0]!.html).toContain("Alex Example hasn&#39;t signed in for 12 months");
    const [alert] = await rows<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM core.alert WHERE type = 'admin_inactive'",
    );
    expect(alert?.payload).toEqual({ userId: "guard-admin" });
  });
});

describe("the cap on sign-in codes", () => {
  it("notes when the day's cap first refuses a code, and the guard says so the next day", async () => {
    const app = new Client({ connectionString: urls.oc_app });
    await app.connect();
    const reserve = async () =>
      (await app.query<{ ok: boolean }>("SELECT core.reserve_email('sign-in', 1) AS ok")).rows[0]?.ok;
    await owner.query(
      "INSERT INTO core.email_send (utc_day, type, count) VALUES (current_date, 'sign-in', 59)",
    );
    expect(await reserve()).toBe(true);
    expect(await reserve()).toBe(false);
    const [first] = await rows<{ count: number; capped_at: Date }>(
      "SELECT count, capped_at FROM core.email_send WHERE type = 'sign-in'",
    );
    expect(first?.count).toBe(60);
    expect(first?.capped_at).toBeInstanceOf(Date);
    // A later refusal keeps the first time.
    expect(await reserve()).toBe(false);
    expect(await rows("SELECT capped_at FROM core.email_send WHERE type = 'sign-in'")).toEqual([
      { capped_at: first?.capped_at },
    ]);
    await app.end();

    const now = new Date();
    now.setUTCDate(now.getUTCDate() + 1);
    now.setUTCHours(9, 15, 0, 0);
    expect(await runGuard({ now, env, deps: { mailFetcher: resend } })).toMatchObject({
      status: "succeeded",
    });
    expect(sent.find((s) => s.key.startsWith("summary-"))?.emails[0]?.html).toContain(
      "The daily limit for sign-in codes was reached at",
    );
  });
});

describe("pruning auth", () => {
  it("removes what has expired and viewers who haven't signed in for 12 months, never admins", async () => {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + 2);
    now.setUTCHours(9, 15, 0, 0);
    await owner.query(
      `INSERT INTO auth.users (id, name, email, first_name, last_name, role, last_sign_in_at) VALUES
         ('guard-old-viewer', 'Old Viewer', 'guard-old@example.com', 'Old', 'Viewer', 'viewer', $1::timestamptz - interval '13 months'),
         ('guard-old-admin', 'Old Admin', 'guard-old-admin@example.com', 'Old', 'Admin', 'admin', $1::timestamptz - interval '13 months')`,
      [now],
    );
    await owner.query(
      `INSERT INTO auth.sessions (id, expires_at, token, user_id) VALUES
         ('guard-s1', $1::timestamptz - interval '1 hour', 'guard-t1', 'guard-viewer'),
         ('guard-s2', $1::timestamptz + interval '1 hour', 'guard-t2', 'guard-viewer')`,
      [now],
    );
    await owner.query(
      `INSERT INTO auth.verifications (id, identifier, value, expires_at) VALUES
         ('guard-v1', 'sign-in-otp-guard-sam@example.com', 'x', $1::timestamptz - interval '1 minute'),
         ('guard-v2', 'sign-in-otp-guard-old@example.com', 'x', $1::timestamptz + interval '5 minutes')`,
      [now],
    );
    await owner.query(
      `INSERT INTO auth.login_throttle (scope, key, window_start, count) VALUES
         ('email', 'guard-sam@example.com', $1::timestamptz - interval '8 days', 1),
         ('email', 'guard-sam@example.com', $1::timestamptz - interval '1 day', 1)`,
      [now],
    );
    await owner.query(
      `INSERT INTO auth.audit_event (event, subject_id, occurred_at) VALUES
         ('sign_in.succeeded', 'guard-viewer', $1::timestamptz - interval '91 days'),
         ('sign_in.succeeded', 'guard-viewer', $1::timestamptz - interval '10 days'),
         ('user.updated', 'guard-viewer', $1::timestamptz - interval '13 months'),
         ('user.updated', 'guard-viewer', $1::timestamptz - interval '91 days')`,
      [now],
    );

    expect(await runGuard({ now, env, deps: { mailFetcher: resend } })).toMatchObject({
      status: "succeeded",
    });

    const [log] = await rows<{ details: { pruned: { auth: Record<string, number> } } }>(
      "SELECT details FROM core.job_run WHERE job = 'guard'",
    );
    expect(log?.details.pruned.auth).toEqual({
      sessions: 1,
      verifications: 1,
      login_throttle: 1,
      sign_in_events: 1,
      admin_events: 1,
      inactive_viewers: 1,
    });
    expect((await rows<{ id: string }>("SELECT id FROM auth.users ORDER BY id")).map((u) => u.id)).toEqual([
      "guard-admin",
      "guard-old-admin",
      "guard-viewer",
    ]);
    // The removed viewer's pending code stops working, and the log keeps a copy of the address.
    expect(await rows("SELECT id FROM auth.verifications")).toEqual([]);
    expect(
      await rows(
        "SELECT subject_id, subject_email, before FROM auth.audit_event WHERE event = 'user.removed'",
      ),
    ).toEqual([
      {
        subject_id: "guard-old-viewer",
        subject_email: "guard-old@example.com",
        before: { role: "viewer", reason: "inactive_12_months" },
      },
    ]);
  });
});
