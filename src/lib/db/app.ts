import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

import { appEnvironment } from "@/lib/env";

// The app's connections (plan 10.5): one pg.Pool with at most 5 connections
// against Neon's pooled address as oc_app, made the first time it is needed and
// registered with attachDatabasePool, so Fluid compute closes idle connections.

let pool: Pool | undefined;

export function appPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: appEnvironment().DATABASE_URL_APP,
      max: 5,
      connectionTimeoutMillis: 15_000,
    });
    attachDatabasePool(pool);
  }
  return pool;
}
