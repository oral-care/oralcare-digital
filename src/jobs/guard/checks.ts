import type { Client } from "pg";

import type { AlertDraft } from "@/lib/alerts/types";

import type { GuardDay } from "./day";
import { rightsDifferences } from "./rights";

// The guard's checks (plan 7 and 8.2): yesterday's measurements, the backup,
// the free plans' limits, the Vercel token, the day's cap on sign-in codes,
// admins who never sign in and the roles' rights. Each finding is an alert for
// "Needs attention" in the summary.

export const BACKUP_MAX_HOURS = 26;
const LIMIT_ALERT_PERCENT = 60;
const TOKEN_WARNING_DAYS = 14;
const GB = 1024 ** 3;
const HOUR_MS = 60 * 60_000;

export type Usage = {
  databaseBytes: number;
  trafficBytesThisMonth: number;
  cpuMsThisMonth: number;
  /** Vercel CPU budget on Hobby. Null on Pro, where it isn't shown (plan 8.2). */
  cpuBudgetHours: number | null;
};

export const DATABASE_LIMIT_BYTES = GB;
export const TRAFFIC_LIMIT_BYTES = 5 * GB;

export const percent = (used: number, limit: number) => Math.floor((used / limit) * 100);

export type MarketRuns = { code: string; countryId: number; succeeded: Date[] };

export async function usage(client: Client, now: Date): Promise<Usage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const result = await client.query<{ database: string; traffic: string; cpu: string; budget: unknown }>(
    `SELECT pg_catalog.pg_database_size(pg_catalog.current_database()) AS database,
            (SELECT coalesce(sum(bytes), 0) FROM core.job_run WHERE job = 'backup' AND started_at >= $1) AS traffic,
            (SELECT coalesce(sum(cpu_ms), 0) FROM core.job_run
              WHERE job IN ('availability', 'guard') AND started_at >= $1) AS cpu,
            (SELECT value FROM core.config_version WHERE key = 'vercel_cpu_budget_hours'
              ORDER BY valid_from DESC LIMIT 1) AS budget`,
    [monthStart],
  );
  const row = result.rows[0]!;
  const budget = Number(row.budget);
  return {
    databaseBytes: Number(row.database),
    trafficBytesThisMonth: Number(row.traffic),
    cpuMsThisMonth: Number(row.cpu),
    cpuBudgetHours: row.budget === null || !Number.isFinite(budget) || budget <= 0 ? null : budget,
  };
}

export async function lastBackup(client: Client): Promise<Date | null> {
  const result = await client.query<{ finished: Date | null }>(
    "SELECT max(finished_at) AS finished FROM core.job_run WHERE job = 'backup' AND status = 'succeeded'",
  );
  return result.rows[0]?.finished ?? null;
}

const size = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

/** Alerts per market (country id) or for the whole system (null). */
export async function guardChecks(
  client: Client,
  input: { now: Date; day: GuardDay; markets: MarketRuns[]; usage: Usage; lastBackup: Date | null },
): Promise<{ countryId: number | null; market: string; alert: AlertDraft }[]> {
  const found: { countryId: number | null; market: string; alert: AlertDraft }[] = [];
  const system = (alert: AlertDraft) => found.push({ countryId: null, market: "-", alert });

  for (const market of input.markets) {
    const done = new Set(market.succeeded.map((d) => d.getTime()));
    const missing = input.day.points.filter((point) => !done.has(point.getTime()));
    if (missing.length > 0) {
      found.push({
        countryId: market.countryId,
        market: market.code,
        alert: { type: "missing_measurements", subject: "-", payload: { points: missing } },
      });
    }
  }

  const hours = input.lastBackup
    ? Math.floor((input.now.getTime() - input.lastBackup.getTime()) / HOUR_MS)
    : null;
  if (hours === null || hours > BACKUP_MAX_HOURS) {
    system({
      type: "backup_old",
      subject: "-",
      payload: { hours: hours ?? 0, lastFinishedAt: input.lastBackup },
    });
  }

  const u = input.usage;
  const limits = [
    { service: "Neon database", used: u.databaseBytes, limit: DATABASE_LIMIT_BYTES, show: size },
    { service: "Neon traffic", used: u.trafficBytesThisMonth, limit: TRAFFIC_LIMIT_BYTES, show: size },
    ...(u.cpuBudgetHours === null
      ? []
      : [
          {
            service: "Vercel CPU",
            used: u.cpuMsThisMonth,
            limit: u.cpuBudgetHours * HOUR_MS,
            show: (ms: number) => `${(ms / HOUR_MS).toFixed(1)} hours`,
          },
        ]),
  ];
  for (const limit of limits) {
    const used = percent(limit.used, limit.limit);
    if (used >= LIMIT_ALERT_PERCENT) {
      system({
        type: "limit",
        subject: limit.service,
        payload: {
          service: limit.service,
          percent: used,
          used: limit.show(limit.used),
          limit: limit.show(limit.limit),
        },
      });
    }
  }

  const token = await client.query<{ value: unknown }>(
    "SELECT value FROM core.config_version WHERE key = 'vercel_token_expires_on' ORDER BY valid_from DESC LIMIT 1",
  );
  const expires = token.rows[0]?.value;
  if (typeof expires === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    const daysLeft = (Date.parse(`${expires}T00:00:00Z`) - input.now.getTime()) / (24 * HOUR_MS);
    if (daysLeft <= TOKEN_WARNING_DAYS)
      system({ type: "vercel_token", subject: expires, payload: { date: expires } });
  }

  // core.reserve_email notes when the cap first refused a code (plan 11).
  const capped = await client.query<{ capped_at: Date }>(
    "SELECT capped_at FROM core.email_send WHERE utc_day = $1::date AND type = 'sign-in' AND capped_at IS NOT NULL",
    [input.day.utcDay],
  );
  const cappedAt = capped.rows[0]?.capped_at;
  if (cappedAt) system({ type: "sign_in_limit", subject: input.day.utcDay, payload: { at: cappedAt } });

  // Admins are never removed automatically, so the guard says when one has stopped signing in (plan 10.4).
  const inactive = await client.query<{ id: string }>(
    `SELECT id FROM auth.users
     WHERE role = 'admin' AND coalesce(last_sign_in_at, created_at) < $1::timestamptz - interval '12 months'
     ORDER BY id`,
    [input.now],
  );
  for (const user of inactive.rows) {
    // The id only: the name is looked up when the summary is written, never stored in an alert.
    system({ type: "admin_inactive", subject: user.id, payload: { userId: user.id } });
  }

  for (const { role, difference } of await rightsDifferences(client)) {
    system({ type: "rights", subject: `${role}:${difference}`, payload: { role, difference } });
  }
  return found;
}
