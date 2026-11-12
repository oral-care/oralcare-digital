import type { Client } from "pg";

import { CHANGE_COLUMNS, changeLine, type ChangeRow } from "@/lib/availability/changes";
import { clinicStatus } from "@/lib/availability/statuses";
import type { MarketSummary, SummaryData } from "@/lib/email/emails";
import type { Market } from "@/lib/markets";

import {
  BACKUP_MAX_HOURS,
  DATABASE_LIMIT_BYTES,
  percent,
  TRAFFIC_LIMIT_BYTES,
  type MarketRuns,
  type Usage,
} from "./checks";
import type { GuardDay } from "./day";

// The daily summary's figures for yesterday (plan 8.2), read from the run log,
// the daily values and the changes. Everything except the alert lines, which
// the guard adds.

const HOUR_MS = 60 * 60_000;

export async function summaryData(
  client: Client,
  input: {
    now: Date;
    day: GuardDay;
    markets: (MarketRuns & { market: Market })[];
    usage: Usage;
    lastBackup: Date | null;
  },
): Promise<Omit<SummaryData, "attention">> {
  const { day } = input;
  const expectedPoints = day.points.length * input.markets.length;
  const ran = input.markets.reduce((sum, m) => sum + new Set(m.succeeded.map((d) => d.getTime())).size, 0);

  const runs = await client.query<{ measured: string | null; expected: string | null }>(
    `SELECT sum((details->'coverage'->>'measured')::int) AS measured, sum((details->'coverage'->>'expected')::int) AS expected
     FROM core.job_run
     WHERE job = 'availability' AND status = 'succeeded' AND schedule_point >= $1 AND schedule_point < $2`,
    [day.start, day.end],
  );
  const measured = Number(runs.rows[0]?.measured ?? 0);
  const expected = Number(runs.rows[0]?.expected ?? 0);

  // Late measurements (plan 5.5 and 8.2): schedule points measured by the retry
  // at the odd hour, from the run log's is_retry. A point has at most one
  // succeeded run, so each counts once.
  const late = await client.query<{ late: number }>(
    `SELECT count(*)::int AS late FROM core.job_run
     WHERE job = 'availability' AND status = 'succeeded' AND is_retry
       AND schedule_point >= $1 AND schedule_point < $2`,
    [day.start, day.end],
  );

  // Yesterday's scheduled jobs that ran: the measurements, the guard and the backups (plan 7).
  const jobs = await client.query<{ guard: number; backups: number }>(
    `SELECT count(*) FILTER (WHERE job = 'guard')::int AS guard, count(*) FILTER (WHERE job = 'backup')::int AS backups
     FROM core.job_run
     WHERE status = 'succeeded' AND job IN ('guard', 'backup') AND schedule_point >= $1 AND schedule_point < $2`,
    [day.start, day.end],
  );
  const expectedBackups = day.isSunday ? 2 : 1;
  const jobRow = jobs.rows[0] ?? { guard: 0, backups: 0 };

  const errors = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM core.app_error WHERE occurred_at >= $1 AND occurred_at < $2",
    [day.start, day.end],
  );
  const emails = await client.query<{ sent: number }>(
    "SELECT coalesce(sum(count), 0)::int AS sent FROM core.email_send WHERE utc_day = $1::date",
    [day.utcDay],
  );

  const markets: MarketSummary[] = [];
  const changes: string[] = [];
  for (const market of input.markets) {
    const summary = await marketSummary(client, market.countryId, market.market.name, day.day);
    if (summary) markets.push(summary);
    changes.push(...(await changeLines(client, market.countryId, day)));
  }

  const u = input.usage;
  return {
    day: day.points[3] ?? day.start,
    measurements: { ran, expected: expectedPoints, late: late.rows[0]?.late ?? 0 },
    coverage: expected > 0 ? (measured / expected) * 100 : null,
    backupDone:
      input.lastBackup !== null &&
      input.now.getTime() - input.lastBackup.getTime() <= BACKUP_MAX_HOURS * HOUR_MS,
    markets,
    changes,
    serverErrors: errors.rows[0]?.count ?? 0,
    usage: {
      jobs: {
        ran: ran + Math.min(jobRow.guard, 1) + Math.min(jobRow.backups, expectedBackups),
        expected: expectedPoints + 1 + expectedBackups,
      },
      neonDatabasePercent: percent(u.databaseBytes, DATABASE_LIMIT_BYTES),
      neonTrafficPercent: percent(u.trafficBytesThisMonth, TRAFFIC_LIMIT_BYTES),
      resendSent: emails.rows[0]?.sent ?? 0,
      vercelCpuPercent:
        u.cpuBudgetHours === null ? null : percent(u.cpuMsThisMonth, u.cpuBudgetHours * HOUR_MS),
    },
  };
}

/**
 * Each clinic on oralcare.se counted once per group, from yesterday's daily
 * values, the way the pages count (plan 5.1, 5.2, 5.7 and 5.8): only
 * treatments in the booking menu, only online treatments for the statuses, a
 * clinic with nothing online but a later slot as First slot and Long, and a
 * clinic with a value that could not be measured on its own row instead of
 * Not online.
 */
export async function marketSummary(
  client: Client,
  countryId: number,
  name: string,
  day: string,
): Promise<MarketSummary | null> {
  const rows = await client.query<{
    clinic_id: number;
    status: string | null;
    availability: "good" | "low" | null;
    waiting_time: "short" | "long" | null;
    first_free_days: number | null;
    searched_to_limit: boolean | null;
    job_run_id: string | null;
    slots_not_online: number | null;
  }>(
    `SELECT c.id AS clinic_id, d.status, d.availability, d.waiting_time, d.first_free_days, d.job_run_id,
            x.slots_not_online,
            round(extract(epoch FROM m.window_end - m.window_start) / 86400)
              >= coalesce((r.details->>'maxLeadDays')::int, 31) AS searched_to_limit
     FROM core.clinic c
     JOIN core.clinic_external_id w ON w.clinic_id = c.id AND upper_inf(w.valid_during)
       AND w.source_system_id = (SELECT id FROM core.source_system WHERE role = 'web' LIMIT 1)
     LEFT JOIN (availability.daily_value d
       JOIN core.treatment_name n ON n.treatment_id = d.treatment_id AND upper_inf(n.valid_during))
       ON d.clinic_id = c.id AND d.day = $2::date AND d.source_system_id = w.source_system_id
     LEFT JOIN availability.comparison x
       ON x.job_run_id = d.job_run_id AND x.clinic_id = d.clinic_id AND x.treatment_id = d.treatment_id
     LEFT JOIN availability.measurement m
       ON m.job_run_id = d.job_run_id AND m.clinic_id = d.clinic_id AND m.treatment_id = d.treatment_id
         AND m.source_system_id = d.source_system_id
     LEFT JOIN core.job_run r ON r.id = d.job_run_id
     WHERE c.country_id = $1`,
    [countryId, day],
  );
  if (!rows.rows.some((r) => r.job_run_id !== null)) return null;

  const byClinic = new Map<
    number,
    {
      unknown: boolean;
      availability: ("good" | "low")[];
      waiting: ("short" | "long")[];
      later: boolean;
      noneInWindow: boolean;
      hidden: boolean;
    }
  >();
  for (const row of rows.rows) {
    const clinic = byClinic.get(row.clinic_id) ?? {
      unknown: false,
      availability: [],
      waiting: [],
      later: false,
      noneInWindow: false,
      hidden: false,
    };
    if (row.status === "could_not_be_measured") clinic.unknown = true;
    // A treatment is online when it has an availability; only those count (plan 5.2).
    if (row.availability !== null) {
      clinic.availability.push(row.availability);
      if (row.waiting_time !== null) clinic.waiting.push(row.waiting_time);
    } else if (row.status === "measured" && row.first_free_days !== null) {
      // Not online within 14 days, but bookable later (plan 5.1).
      clinic.later = true;
    } else if (row.status === "measured" && row.searched_to_limit !== true) {
      // Nothing in the 30 days a measurement before the change searched (plan 5.1).
      clinic.noneInWindow = true;
    }
    if ((row.slots_not_online ?? 0) > 0) clinic.hidden = true;
    byClinic.set(row.clinic_id, clinic);
  }
  const availability = { good: 0, low: 0, mixed: 0, later: 0, notOnline: 0 };
  const waitingTime = { short: 0, long: 0, mixed: 0, notOnline: 0 };
  let couldNotBeMeasured = 0;
  let noneInWindow = 0;
  for (const clinic of byClinic.values()) {
    if (clinic.unknown) {
      couldNotBeMeasured++;
      continue;
    }
    if (clinic.availability.length === 0 && clinic.later) {
      availability.later++;
      waitingTime.long++;
      continue;
    }
    if (clinic.availability.length === 0 && clinic.noneInWindow) {
      noneInWindow++;
      continue;
    }
    availability[clinicStatus(clinic.availability)]++;
    waitingTime[clinicStatus(clinic.waiting)]++;
  }
  const slotsNotOnline = [...byClinic.values()].filter((c) => c.hidden).length;
  return { name, availability, waitingTime, noneInWindow, couldNotBeMeasured, slotsNotOnline };
}

/** Yesterday's changes in the offering as lines, with the names they had last (plan 6.5). */
async function changeLines(client: Client, countryId: number, day: GuardDay): Promise<string[]> {
  const rows = await client.query<ChangeRow>(
    `SELECT ${CHANGE_COLUMNS}
     FROM availability.change_event e
     WHERE e.country_id = $1 AND e.created_at >= $2 AND e.created_at < $3
     ORDER BY e.id`,
    [countryId, day.start, day.end],
  );
  return rows.rows.map(changeLine);
}
