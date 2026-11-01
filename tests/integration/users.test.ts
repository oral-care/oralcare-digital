import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { deliverCode } from "@/lib/auth/deliver-code";
import { acceptInvitation, openInvitation } from "@/lib/auth/invitation";
import type { Viewer } from "@/lib/auth/permissions";
import { allowCodeRequest, isLocked, recordFailure } from "@/lib/auth/throttle";
import type { Fetcher } from "@/lib/email/resend";
import { inviteUser, removeUser, updateUser } from "@/lib/users/manage";

// Users and sign-in against Postgres with the app's own role (plan 3.4, 11
// and 15.2): invitations, the first sign-in, changes, removal, the last admin,
// two admins at once, the limits and who gets a code. Resend is a fake.

const urls = inject("databaseUrls");
let owner: Client;
let app: Pool;

let sent: { key: string | null; to: string[]; subject: string }[] = [];
let resendStatus = 200;
const resend: Fetcher = async (_url, init) => {
  const body = JSON.parse(String(init.body)) as { to: string[]; subject: string }[];
  for (const email of body) {
    sent.push({
      key: new Headers(init.headers).get("Idempotency-Key"),
      to: email.to,
      subject: email.subject,
    });
  }
  return new Response("{}", { status: resendStatus });
};
const mail = { apiKey: "re_test_0000000000000000", fetcher: resend };

const admin: Viewer = {
  id: "users-admin",
  email: "ada@oralcare.se",
  firstName: "Ada",
  lastName: "Admin",
  role: "admin",
  external: false,
  views: ["availability"],
  markets: ["se"],
};

async function createUser(id: string, email: string, role: "viewer" | "admin", external = false) {
  await owner.query(
    `INSERT INTO auth.users (id, name, email, first_name, last_name, role, external)
     VALUES ($1, $2, $3, 'Test', 'Person', $4, $5)`,
    [id, "Test Person", email, role, external],
  );
}

const rows = async <T>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  await owner.connect();
  app = new Pool({ connectionString: urls.oc_app, max: 4 });
});

beforeEach(async () => {
  // Other test files share the database.
  await owner.query(
    `TRUNCATE auth.users, auth.invitation, auth.audit_event, auth.login_throttle, auth.email_suppression,
              auth.verifications, core.email_send CASCADE`,
  );
  await owner.query(
    "DELETE FROM core.config_version WHERE key = 'login_paused' AND valid_from > now() - interval '1 day'",
  );
  await createUser(admin.id, admin.email, "admin");
  sent = [];
  resendStatus = 200;
});

afterAll(async () => {
  await owner.query("TRUNCATE auth.users, auth.invitation, auth.audit_event, auth.login_throttle CASCADE");
  await app.end();
  await owner.end();
});

const invite = (email: string, extra: Partial<Parameters<typeof inviteUser>[2]> = {}) =>
  inviteUser(
    app,
    admin,
    {
      email,
      firstName: "Sam",
      lastName: "Example",
      views: ["availability"],
      markets: ["se"],
      role: "viewer",
      ...extra,
    },
    mail,
  );

describe("inviting", () => {
  it("saves the invitation, sends one e-mail with the invitation's key and logs it", async () => {
    expect(await invite(" Sam@OralCare.se ")).toEqual({ ok: true });
    expect(await rows("SELECT email, role, views, markets, used_at FROM auth.invitation")).toEqual([
      { email: "sam@oralcare.se", role: "viewer", views: ["availability"], markets: ["se"], used_at: null },
    ]);
    expect(sent).toEqual([
      {
        key: expect.stringMatching(/^invitation-\d+$/),
        to: ["sam@oralcare.se"],
        subject: "Ada Admin invited you to Oral Care Digital",
      },
    ]);
    expect(await rows("SELECT event, subject_email FROM auth.audit_event")).toEqual([
      { event: "user.invited", subject_email: "sam@oralcare.se" },
    ]);
  });

  it("keeps no invitation when Resend refuses the e-mail", async () => {
    resendStatus = 500;
    expect(await invite("sam@oralcare.se")).toEqual({ ok: false, errors: { form: "users.errors.notSent" } });
    expect(await rows("SELECT 1 FROM auth.invitation")).toHaveLength(0);
    expect(await rows("SELECT 1 FROM auth.audit_event")).toHaveLength(0);
  });

  it("refuses a taken address, missing fields and an outside address with data views", async () => {
    expect(await invite("ada@oralcare.se")).toMatchObject({ errors: { email: "users.errors.taken" } });
    expect(await invite("sam@oralcare.se", { firstName: " ", views: [] })).toMatchObject({
      errors: { firstName: "users.errors.firstName", views: "users.errors.views" },
    });
    expect(await invite("kim@agency.example")).toMatchObject({
      errors: { views: "users.errors.externalViews" },
    });
    expect(await invite("kim@agency.example", { views: ["tracking-framework"] })).toEqual({ ok: true });
  });

  it("lifts the suppression of an address an admin invites again", async () => {
    await owner.query(
      "INSERT INTO auth.email_suppression (email, reason) VALUES ('sam@oralcare.se', 'bounce')",
    );
    expect(await invite("sam@oralcare.se")).toEqual({ ok: true });
    expect(await rows("SELECT 1 FROM auth.email_suppression")).toHaveLength(0);
  });

  it("only lets admins invite", async () => {
    expect(
      await inviteUser(
        app,
        { ...admin, role: "viewer" },
        {
          email: "x@oralcare.se",
          firstName: "X",
          lastName: "Y",
          views: ["nps"],
          markets: ["se"],
          role: "viewer",
        },
        mail,
      ),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("the first sign-in", () => {
  it("copies the invitation's views and markets once, and marks it used", async () => {
    await invite("sam@oralcare.se", { views: ["availability", "nps"], markets: ["se", "dk"] });
    expect(await openInvitation(app, "sam@oralcare.se")).toMatchObject({ firstName: "Sam", role: "viewer" });
    await createUser("sam", "sam@oralcare.se", "viewer");
    expect(await acceptInvitation(app, "sam", "sam@oralcare.se")).toBe(true);
    expect(await acceptInvitation(app, "sam", "sam@oralcare.se")).toBe(false);
    expect(await rows("SELECT view FROM auth.user_view WHERE user_id = 'sam' ORDER BY view")).toEqual([
      { view: "availability" },
      { view: "nps" },
    ]);
    expect(await rows("SELECT count(*)::int AS n FROM auth.user_market WHERE user_id = 'sam'")).toEqual([
      { n: 2 },
    ]);
    expect(await openInvitation(app, "sam@oralcare.se")).toBeNull();
  });

  it("can never give an outside account a data view, also directly in the database", async () => {
    await createUser("kim", "kim@agency.example", "viewer", true);
    await expect(
      owner.query(
        "INSERT INTO auth.user_view (user_id, view, external) VALUES ('kim', 'availability', true)",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("changing and removing", () => {
  beforeEach(async () => {
    await createUser("sam", "sam@oralcare.se", "viewer");
    await owner.query(
      "INSERT INTO auth.user_view (user_id, view, external) VALUES ('sam', 'availability', false)",
    );
  });

  const access = {
    firstName: "Sam",
    lastName: "Changed",
    views: ["nps"] as const,
    markets: ["no"] as const,
    role: "viewer" as const,
  };

  it("replaces the views and markets and logs before and after", async () => {
    expect(
      await updateUser(app, admin, "sam", {
        ...access,
        views: [...access.views],
        markets: [...access.markets],
      }),
    ).toEqual({ ok: true });
    expect(await rows("SELECT view FROM auth.user_view WHERE user_id = 'sam'")).toEqual([{ view: "nps" }]);
    const [event] = await rows<{ before: { views: string[] }; after: { views: string[] } }>(
      "SELECT before, after FROM auth.audit_event WHERE event = 'user.updated'",
    );
    expect(event).toMatchObject({ before: { views: ["availability"] }, after: { views: ["nps"] } });
  });

  it("keeps people from changing their own role and from demoting the last admin", async () => {
    expect(
      await updateUser(app, admin, admin.id, { ...access, views: ["nps"], markets: ["se"], role: "viewer" }),
    ).toMatchObject({
      errors: { role: "users.errors.ownRole" },
    });
    const other: Viewer = { ...admin, id: "other-admin" };
    expect(
      await updateUser(app, other, admin.id, { ...access, views: ["nps"], markets: ["se"], role: "viewer" }),
    ).toMatchObject({
      errors: { role: "users.errors.lastAdmin" },
    });
  });

  it("lets only one of two admins demote the other at the same time", async () => {
    await createUser("bea", "bea@oralcare.se", "admin");
    const bea: Viewer = { ...admin, id: "bea", email: "bea@oralcare.se" };
    const demote = (actor: Viewer, id: string) =>
      updateUser(app, actor, id, {
        firstName: "X",
        lastName: "Y",
        views: ["nps"],
        markets: ["se"],
        role: "viewer",
      });
    const results = await Promise.all([demote(admin, "bea"), demote(bea, admin.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await rows("SELECT count(*)::int AS n FROM auth.users WHERE role = 'admin'")).toEqual([{ n: 1 }]);
  });

  it("removes a user with their sessions and a code already sent, and never the last admin or oneself", async () => {
    await owner.query(
      `INSERT INTO auth.sessions (id, token, user_id, expires_at) VALUES ('s1', 't1', 'sam', now() + interval '1 hour');
       INSERT INTO auth.verifications (id, identifier, value, expires_at)
       VALUES ('v1', 'sign-in-otp-sam@oralcare.se', 'x', now() + interval '10 minutes')`,
    );
    expect(await removeUser(app, admin, "sam")).toEqual({ ok: true });
    expect(await rows("SELECT 1 FROM auth.sessions UNION ALL SELECT 1 FROM auth.verifications")).toHaveLength(
      0,
    );
    expect(await rows("SELECT event, subject_email FROM auth.audit_event")).toEqual([
      { event: "user.removed", subject_email: "sam@oralcare.se" },
    ]);
    expect(await removeUser(app, admin, admin.id)).toMatchObject({
      errors: { form: "users.errors.removeSelf" },
    });
    expect(await removeUser(app, { ...admin, id: "other-admin" }, admin.id)).toMatchObject({
      errors: { form: "users.errors.lastAdmin" },
    });
  });
});

describe("the sign-in limits", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("allows 3 codes per 15 minutes per address", async () => {
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await allowCodeRequest(app, "sam@oralcare.se", `198.51.100.${i}`, now));
    expect(results).toEqual([true, true, true, false]);
  });

  it("makes an address wait after 3 wrong codes", async () => {
    for (let i = 0; i < 2; i++) await recordFailure(app, "sam@oralcare.se", "198.51.100.9", now);
    expect(await isLocked(app, "sam@oralcare.se", "198.51.100.9", now)).toBe(false);
    await recordFailure(app, "sam@oralcare.se", "198.51.100.9", now);
    expect(await isLocked(app, "sam@oralcare.se", "203.0.113.1", now)).toBe(true);
    expect(await isLocked(app, "sam@oralcare.se", "203.0.113.1", new Date(now.getTime() + 61_000))).toBe(
      false,
    );
  });
});

describe("who gets a code", () => {
  const deliver = (email: string) =>
    deliverCode(app, { email, code: "48217390", ip: "198.51.100.1", apiKey: mail.apiKey, fetcher: resend });

  it("sends only to an account or an invitation, and says nothing different to others", async () => {
    expect(await deliver("nobody@oralcare.se")).toBe("not_allowed");
    expect(await deliver("ada@oralcare.se")).toBe("sent");
    expect(sent).toEqual([
      { key: null, to: ["ada@oralcare.se"], subject: "Your sign-in code for Oral Care Digital" },
    ]);
    expect(await rows("SELECT count::int FROM core.email_send WHERE type = 'sign-in'")).toEqual([
      { count: 1 },
    ]);
  });

  it("sends nothing to a suppressed address or while sign-in is paused", async () => {
    await owner.query(
      "INSERT INTO auth.email_suppression (email, reason) VALUES ('ada@oralcare.se', 'bounce')",
    );
    expect(await deliver("ada@oralcare.se")).toBe("suppressed");
    await owner.query("DELETE FROM auth.email_suppression");
    await owner.query(
      "INSERT INTO core.config_version (key, value, note) VALUES ('login_paused', 'true', 'test')",
    );
    expect(await deliver("ada@oralcare.se")).toBe("paused");
    expect(sent).toHaveLength(0);
  });
});
