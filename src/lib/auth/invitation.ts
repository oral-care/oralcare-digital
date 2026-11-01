import "server-only";

import type { Pool } from "pg";

// The first sign-in (plan 11): an address signs up only with an unused
// invitation, and the invitation's views and markets become the user's. The
// copy is one transaction and safe to run again, so a sign-in that stopped
// half-way is completed the next time the session is read.

export type OpenInvitation = {
  id: number;
  firstName: string;
  lastName: string;
  role: "viewer" | "admin";
  views: string[];
  markets: string[];
};

export async function openInvitation(pool: Pool, email: string): Promise<OpenInvitation | null> {
  const result = await pool.query<{
    id: string;
    first_name: string;
    last_name: string;
    role: "viewer" | "admin";
    views: string[];
    markets: string[];
  }>(
    `SELECT id, first_name, last_name, role, views, markets FROM auth.invitation
     WHERE email = $1 AND used_at IS NULL`,
    [email],
  );
  const row = result.rows[0];
  return row
    ? {
        id: Number(row.id),
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        views: row.views,
        markets: row.markets,
      }
    : null;
}

/** Copies the invitation's views and markets to the user and marks it used. Returns false if there was none. */
export async function acceptInvitation(pool: Pool, userId: string, email: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ id: string; views: string[]; markets: string[] }>(
      "SELECT id, views, markets FROM auth.invitation WHERE email = $1 AND used_at IS NULL FOR UPDATE",
      [email],
    );
    const invitation = found.rows[0];
    if (!invitation) {
      await client.query("ROLLBACK");
      return false;
    }
    const user = await client.query<{ external: boolean }>("SELECT external FROM auth.users WHERE id = $1", [
      userId,
    ]);
    await client.query(
      `INSERT INTO auth.user_view (user_id, view, external) SELECT $1, unnest($2::text[]), $3
       ON CONFLICT DO NOTHING`,
      [userId, invitation.views, user.rows[0]?.external ?? false],
    );
    await client.query(
      `INSERT INTO auth.user_market (user_id, country_id) SELECT $1, c.id FROM core.country c WHERE c.code = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [userId, invitation.markets],
    );
    await client.query("UPDATE auth.invitation SET used_at = now() WHERE id = $1", [invitation.id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
