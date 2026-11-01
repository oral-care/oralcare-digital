import "server-only";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { AdminEvent } from "@/lib/audit";
import { isGroupEmail, normalizeEmail } from "@/lib/auth/allowed-email";
import { isAdmin, type Viewer } from "@/lib/auth/permissions";
import { ROLES, VIEW_KEYS } from "@/lib/db/schema/auth";
import { invitationEmail } from "@/lib/email/emails";
import { sendBatch, type Fetcher } from "@/lib/email/resend";
import { MARKET_CODES, marketByCode } from "@/lib/markets";

// Inviting, changing and removing users (plan 3.4, 4.9 and 11). Each runs in
// one transaction. The admins are counted with SELECT ... FOR UPDATE, so two
// admins can't remove or demote each other at the same time. Errors are keys
// in messages/en.json under users.errors, shown at the field.

export type Field = "firstName" | "lastName" | "email" | "views" | "markets" | "role" | "form";
export type Result = { ok: true } | { ok: false; errors: Partial<Record<Field, string>> };

const fail = (field: Field, key: string): Result => ({
  ok: false,
  errors: { [field]: `users.errors.${key}` },
});

const access = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  views: z.array(z.enum(VIEW_KEYS)).min(1),
  markets: z.array(z.enum(MARKET_CODES)).min(1),
  role: z.enum(ROLES),
});

export type AccessInput = z.input<typeof access>;

function validate(
  input: unknown,
): { ok: true; value: z.infer<typeof access> } | { ok: false; result: Result } {
  const parsed = access.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]) as Field;
    errors[field] ??= `users.errors.${field}`;
  }
  return { ok: false, result: { ok: false, errors } };
}

/** An address outside the group may only have Tracking Framework (plan 3.1). */
const externalOk = (email: string, views: string[]) =>
  isGroupEmail(email) || (views.length === 1 && views[0] === "tracking-framework");

async function audit(
  db: Pick<PoolClient, "query">,
  event: AdminEvent,
  actor: Viewer,
  subject: {
    id: string | null;
    email: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO auth.audit_event (event, actor_id, subject_id, subject_email, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [event, actor.id, subject.id, subject.email, subject.before ?? null, subject.after ?? null],
  );
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

class Abort extends Error {
  constructor(readonly result: Result) {
    super("aborted");
  }
}

/** Runs the work and turns an Abort into its result, after the rollback. */
async function attempt(pool: Pool, work: (client: PoolClient) => Promise<Result>): Promise<Result> {
  try {
    return await inTransaction(pool, work);
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

export async function inviteUser(
  pool: Pool,
  actor: Viewer,
  input: AccessInput & { email: string },
  mail: { apiKey: string | undefined; fetcher?: Fetcher },
): Promise<Result> {
  if (!isAdmin(actor)) return fail("form", "notAllowed");
  const checked = validate(input);
  if (!checked.ok) return checked.result;
  const email = normalizeEmail(input.email);
  if (!email) return fail("email", "email");
  const { firstName, lastName, views, markets, role } = checked.value;
  if (!externalOk(email, views)) return fail("views", "externalViews");

  return attempt(pool, async (client) => {
    const taken = await client.query(
      `SELECT 1 FROM auth.users WHERE email = $1 UNION ALL SELECT 1 FROM auth.invitation WHERE email = $1`,
      [email],
    );
    if ((taken.rowCount ?? 0) > 0) return fail("email", "taken");

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auth.invitation (email, first_name, last_name, role, views, markets, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [email, firstName, lastName, role, views, markets, actor.id],
    );
    // An admin inviting the address again confirms it after a bounce (plan 9).
    await client.query("DELETE FROM auth.email_suppression WHERE email = $1", [email]);
    await audit(client, "user.invited", actor, {
      id: null,
      email,
      after: { firstName, lastName, role, views, markets },
    });

    // The invitation is kept only if Resend took the e-mail (plan 9).
    const reserved = await client.query<{ ok: boolean }>("SELECT core.reserve_email('invitation', 1) AS ok");
    if (!mail.apiKey || !reserved.rows[0]?.ok) throw new Abort(fail("form", "notSent"));
    const sent = await sendBatch({
      apiKey: mail.apiKey,
      recipients: [email],
      idempotencyKey: `invitation-${inserted.rows[0]!.id}`,
      email: invitationEmail({
        adminName: `${actor.firstName} ${actor.lastName}`,
        firstName,
        markets: MARKET_CODES.filter((code) => markets.includes(code)).map((code) => marketByCode(code).name),
        role,
        email,
      }),
      fetcher: mail.fetcher,
    });
    if (!sent.ok) throw new Abort(fail("form", "notSent"));
    return { ok: true };
  });
}

/** Locks every admin row, so the count can't change until the transaction ends. */
async function lockAdmins(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM auth.users WHERE role = 'admin' FOR UPDATE",
  );
  return result.rows.map((r) => r.id);
}

export async function updateUser(pool: Pool, actor: Viewer, id: string, input: AccessInput): Promise<Result> {
  if (!isAdmin(actor)) return fail("form", "notAllowed");
  const checked = validate(input);
  if (!checked.ok) return checked.result;
  const { firstName, lastName, views, markets, role } = checked.value;

  return attempt(pool, async (client) => {
    if (id.startsWith("invitation:")) {
      const invitationId = Number(id.slice("invitation:".length));
      const found = await client.query<{
        email: string;
        first_name: string;
        last_name: string;
        role: string;
        views: string[];
        markets: string[];
      }>(
        "SELECT email, first_name, last_name, role, views, markets FROM auth.invitation WHERE id = $1 AND used_at IS NULL FOR UPDATE",
        [invitationId],
      );
      const before = found.rows[0];
      if (!before) return fail("form", "gone");
      if (!externalOk(before.email, views)) return fail("views", "externalViews");
      await client.query(
        "UPDATE auth.invitation SET first_name = $2, last_name = $3, role = $4, views = $5, markets = $6 WHERE id = $1",
        [invitationId, firstName, lastName, role, views, markets],
      );
      await audit(client, "user.updated", actor, {
        id: null,
        email: before.email,
        before: {
          firstName: before.first_name,
          lastName: before.last_name,
          role: before.role,
          views: before.views,
          markets: before.markets,
        },
        after: { firstName, lastName, role, views, markets },
      });
      return { ok: true };
    }

    const admins = await lockAdmins(client);
    const found = await client.query<{
      email: string;
      first_name: string;
      last_name: string;
      role: string;
      external: boolean;
    }>("SELECT email, first_name, last_name, role, external FROM auth.users WHERE id = $1 FOR UPDATE", [id]);
    const user = found.rows[0];
    if (!user) return fail("form", "gone");
    if (id === actor.id && role !== user.role) return fail("role", "ownRole");
    if (user.role === "admin" && role !== "admin" && admins.length <= 1) return fail("role", "lastAdmin");
    if (!externalOk(user.email, views)) return fail("views", "externalViews");

    const beforeAccess = await client.query<{ views: string[] | null; markets: string[] | null }>(
      `SELECT (SELECT array_agg(view ORDER BY view) FROM auth.user_view WHERE user_id = $1) AS views,
              (SELECT array_agg(c.code ORDER BY c.code) FROM auth.user_market m JOIN core.country c ON c.id = m.country_id
                WHERE m.user_id = $1) AS markets`,
      [id],
    );
    await client.query(
      "UPDATE auth.users SET first_name = $2, last_name = $3, name = $2 || ' ' || $3, role = $4, updated_at = now() WHERE id = $1",
      [id, firstName, lastName, role],
    );
    await client.query("DELETE FROM auth.user_view WHERE user_id = $1", [id]);
    await client.query(
      "INSERT INTO auth.user_view (user_id, view, external) SELECT $1, unnest($2::text[]), $3",
      [id, views, user.external],
    );
    await client.query("DELETE FROM auth.user_market WHERE user_id = $1", [id]);
    await client.query(
      "INSERT INTO auth.user_market (user_id, country_id) SELECT $1, id FROM core.country WHERE code = ANY($2::text[])",
      [id, markets],
    );
    await audit(client, "user.updated", actor, {
      id,
      email: user.email,
      before: {
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        views: beforeAccess.rows[0]?.views ?? [],
        markets: beforeAccess.rows[0]?.markets ?? [],
      },
      after: { firstName, lastName, role, views: [...views].sort(), markets: [...markets].sort() },
    });
    return { ok: true };
  });
}

export async function removeUser(pool: Pool, actor: Viewer, id: string): Promise<Result> {
  if (!isAdmin(actor)) return fail("form", "notAllowed");
  if (id === actor.id) return fail("form", "removeSelf");

  return attempt(pool, async (client) => {
    if (id.startsWith("invitation:")) {
      const removed = await client.query<{ email: string }>(
        "DELETE FROM auth.invitation WHERE id = $1 AND used_at IS NULL RETURNING email",
        [Number(id.slice("invitation:".length))],
      );
      const email = removed.rows[0]?.email;
      if (!email) return fail("form", "gone");
      await client.query("DELETE FROM auth.verifications WHERE identifier = $1", [`sign-in-otp-${email}`]);
      await audit(client, "user.removed", actor, { id: null, email, before: { invited: true } });
      return { ok: true };
    }

    const admins = await lockAdmins(client);
    const found = await client.query<{ email: string; role: string; first_name: string; last_name: string }>(
      "SELECT email, role, first_name, last_name FROM auth.users WHERE id = $1 FOR UPDATE",
      [id],
    );
    const user = found.rows[0];
    if (!user) return fail("form", "gone");
    if (user.role === "admin" && admins.length <= 1) return fail("form", "lastAdmin");

    // Sessions, views and markets follow with ON DELETE CASCADE; a code already sent stops working.
    await client.query("DELETE FROM auth.users WHERE id = $1", [id]);
    await client.query("DELETE FROM auth.invitation WHERE email = $1", [user.email]);
    await client.query("DELETE FROM auth.login_throttle WHERE key = $1", [`email:${user.email}`]);
    await client.query("DELETE FROM auth.verifications WHERE identifier = $1", [`sign-in-otp-${user.email}`]);
    await audit(client, "user.removed", actor, {
      id,
      email: user.email,
      before: { firstName: user.first_name, lastName: user.last_name, role: user.role },
    });
    return { ok: true };
  });
}
