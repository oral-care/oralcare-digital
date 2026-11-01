import type { Client } from "pg";

import { ADMIN_EVENTS, REMOVED_INACTIVE, SIGN_IN_EVENTS } from "@/lib/audit";

// The guard's pruning of auth with the app's role (plan 10.4): expired codes
// and sessions, throttle rows older than 7 days, sign-in events after 90
// days, admin events after 12 months, and viewers who haven't signed in for
// 12 months. Removing a viewer works like removing one in Users (plan 11):
// the user's rows go with it, and user.removed keeps a copy of the address.
// Admins are never removed; the guard alerts instead. core is pruned by
// core.prune().

const BATCH = 5_000;
const REMOVALS_PER_RUN = 500;

async function inBatches(client: Client, sql: string, params: unknown[]): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await client.query(sql, params);
    total += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < BATCH) return total;
  }
}

const deleteWhere = (table: string, where: string) =>
  `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${BATCH})`;

export async function pruneAuth(client: Client, now: Date): Promise<Record<string, number>> {
  const at = [now];
  const removed = {
    sessions: await inBatches(client, deleteWhere("auth.sessions", "expires_at < $1"), at),
    verifications: await inBatches(client, deleteWhere("auth.verifications", "expires_at < $1"), at),
    login_throttle: await inBatches(
      client,
      deleteWhere("auth.login_throttle", "window_start < $1::timestamptz - interval '7 days'"),
      at,
    ),
    sign_in_events: await inBatches(
      client,
      deleteWhere(
        "auth.audit_event",
        "event = ANY($2::text[]) AND occurred_at < $1::timestamptz - interval '90 days'",
      ),
      [now, SIGN_IN_EVENTS],
    ),
    admin_events: await inBatches(
      client,
      deleteWhere(
        "auth.audit_event",
        "event = ANY($2::text[]) AND occurred_at < $1::timestamptz - interval '12 months'",
      ),
      [now, ADMIN_EVENTS],
    ),
    inactive_viewers: 0,
  };

  const inactive = await client.query<{ id: string; email: string }>(
    `SELECT id, email FROM auth.users
     WHERE role = 'viewer' AND coalesce(last_sign_in_at, created_at) < $1::timestamptz - interval '12 months'
     ORDER BY id LIMIT ${REMOVALS_PER_RUN}`,
    at,
  );
  for (const user of inactive.rows) {
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM auth.invitation WHERE email = $1", [user.email]);
      await client.query("DELETE FROM auth.login_throttle WHERE key = $1", [user.email]);
      // A code already sent stops working (plan 11).
      await client.query("DELETE FROM auth.verifications WHERE identifier = $1", [
        `sign-in-otp-${user.email}`,
      ]);
      // Sessions, accounts, views and markets follow with ON DELETE CASCADE.
      const deleted = await client.query("DELETE FROM auth.users WHERE id = $1 AND role = 'viewer'", [
        user.id,
      ]);
      if (deleted.rowCount === 1) {
        await client.query(
          `INSERT INTO auth.audit_event (event, actor_id, subject_id, subject_email, before, occurred_at)
           VALUES ('user.removed', NULL, $1, $2, $3, $4)`,
          [user.id, user.email, { role: "viewer", reason: REMOVED_INACTIVE }, now],
        );
        removed.inactive_viewers++;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  return removed;
}
