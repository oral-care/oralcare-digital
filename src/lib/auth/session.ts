import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { appPool } from "@/lib/db/app";
import type { Role, ViewKey } from "@/lib/db/schema/auth";
import { isMarketCode, type MarketCode } from "@/lib/markets";

import { getAuth } from "./auth";
import { acceptInvitation } from "./invitation";
import type { Viewer } from "./permissions";

// The signed-in user for this request (plan 11 and 12), read once per request
// with React cache(). Views, markets and role come from the database every
// time, so an admin's change applies from the person's next request. A
// session older than 12 hours ends here, since Better Auth has no ceiling.

const CEILING_MS = 12 * 60 * 60_000;

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const requestHeaders = await headers();
  const auth = getAuth();
  const found = await auth.api.getSession({ headers: requestHeaders });
  if (!found) return null;

  const pool = appPool();
  if (Date.now() - new Date(found.session.createdAt).getTime() > CEILING_MS) {
    await pool.query("DELETE FROM auth.sessions WHERE id = $1", [found.session.id]);
    return null;
  }

  const load = () => loadViewer(found.user.id);
  let viewer = await load();
  // A first sign-in that stopped before its invitation was copied is completed now.
  if (viewer && viewer.views.length === 0 && viewer.markets.length === 0) {
    if (await acceptInvitation(pool, viewer.id, viewer.email)) viewer = await load();
  }
  return viewer;
});

async function loadViewer(userId: string): Promise<Viewer | null> {
  const result = await appPool().query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: Role;
    external: boolean;
    views: ViewKey[] | null;
    markets: string[] | null;
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.external,
            (SELECT array_agg(v.view ORDER BY v.view) FROM auth.user_view v WHERE v.user_id = u.id) AS views,
            (SELECT array_agg(c.code ORDER BY c.code) FROM auth.user_market m JOIN core.country c ON c.id = m.country_id
              WHERE m.user_id = u.id) AS markets
     FROM auth.users u WHERE u.id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    external: row.external,
    views: row.views ?? [],
    markets: (row.markets ?? []).filter(isMarketCode) as MarketCode[],
  };
}
