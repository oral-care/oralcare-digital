import "server-only";

import { getViewer } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/permissions";
import { appPool } from "@/lib/db/app";
import type { Role, ViewKey } from "@/lib/db/schema/auth";
import { isMarketCode, type MarketCode } from "@/lib/markets";

// The Users list (plan 4.9): every user and every invitation that hasn't been
// used, in all markets. Admins only.

export type UserRow = {
  /** A user's id, or "invitation:{id}" for someone who hasn't signed in yet. */
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  views: ViewKey[];
  markets: MarketCode[];
  /** Null for an invitation. */
  lastSignInAt: Date | null;
  invited: boolean;
};

export async function listUsers(): Promise<UserRow[] | null> {
  const viewer = await getViewer();
  if (!viewer || !isAdmin(viewer)) return null;
  const result = await appPool().query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: Role;
    views: ViewKey[] | null;
    markets: string[] | null;
    last_sign_in_at: Date | null;
    invited: boolean;
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.last_sign_in_at, false AS invited,
            (SELECT array_agg(v.view) FROM auth.user_view v WHERE v.user_id = u.id) AS views,
            (SELECT array_agg(c.code) FROM auth.user_market m JOIN core.country c ON c.id = m.country_id
              WHERE m.user_id = u.id) AS markets
     FROM auth.users u
     UNION ALL
     SELECT 'invitation:' || i.id, i.email, i.first_name, i.last_name, i.role, NULL, true, i.views, i.markets
     FROM auth.invitation i
     WHERE i.used_at IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.email = i.email)
     ORDER BY first_name, last_name, email`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    role: r.role,
    views: r.views ?? [],
    markets: (r.markets ?? []).filter(isMarketCode),
    lastSignInAt: r.last_sign_in_at,
    invited: r.invited,
  }));
}
