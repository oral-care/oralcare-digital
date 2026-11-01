import type { Client } from "pg";

import { clinicStatus } from "@/lib/availability/statuses";
import type { MarketSummary, SummaryData } from "@/lib/email/emails";
import type { Market } from "@/lib/markets";
import { t } from "@/lib/messages";

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
    measurements: { ran, expected: expectedPoints },
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

/** Each clinic on the web counted once per group, from yesterday's daily values (plan 5.2). */
async function marketSummary(
  client: Client,
  countryId: number,
  name: string,
  day: string,
): Promise<MarketSummary | null> {
  const rows = await client.query<{
    clinic_id: number;
    availability: "good" | "low" | null;
    waiting_time: "short" | "long" | null;
    job_run_id: string | null;
  }>(
    `SELECT c.id AS clinic_id, d.availability, d.waiting_time, d.job_run_id
     FROM core.clinic c
     JOIN core.clinic_external_id w ON w.clinic_id = c.id AND upper_inf(w.valid_during)
       AND w.source_system_id = (SELECT id FROM core.source_system WHERE role = 'web' LIMIT 1)
     LEFT JOIN availability.daily_value d ON d.clinic_id = c.id AND d.day = $2::date AND d.status = 'measured'
       AND d.source_system_id = w.source_system_id
     WHERE c.country_id = $1`,
    [countryId, day],
  );
  const runIds = [...new Set(rows.rows.map((r) => r.job_run_id).filter((id): id is string => id !== null))];
  if (runIds.length === 0) return null;

  const byClinic = new Map<
    number,
    { availability: ("good" | "low" | null)[]; waiting: ("short" | "long" | null)[] }
  >();
  for (const row of rows.rows) {
    const clinic = byClinic.get(row.clinic_id) ?? { availability: [], waiting: [] };
    clinic.availability.push(row.availability);
    clinic.waiting.push(row.waiting_time);
    byClinic.set(row.clinic_id, clinic);
  }
  const availability = { good: 0, low: 0, mixed: 0, notOnline: 0 };
  const waitingTime = { short: 0, long: 0, mixed: 0, notOnline: 0 };
  for (const clinic of byClinic.values()) {
    availability[clinicStatus(clinic.availability)]++;
    waitingTime[clinicStatus(clinic.waiting)]++;
  }

  const notOnline = await client.query<{ clinics: number }>(
    `SELECT count(DISTINCT x.clinic_id)::int AS clinics FROM availability.comparison x
     JOIN core.clinic c ON c.id = x.clinic_id
     WHERE x.job_run_id = ANY($1::bigint[]) AND c.country_id = $2 AND x.slots_not_online > 0`,
    [runIds, countryId],
  );
  return { name, availability, waitingTime, slotsNotOnline: notOnline.rows[0]?.clinics ?? 0 };
}

/** Yesterday's changes in the offering as lines, with the names they had last (plan 6.5). */
async function changeLines(client: Client, countryId: number, day: GuardDay): Promise<string[]> {
  const rows = await client.query<{
    kind: string;
    clinic: string | null;
    treatment: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    region_before: string | null;
    region_after: string | null;
  }>(
    `SELECT e.kind,
            (SELECT n.name FROM core.clinic_name n WHERE n.clinic_id = e.clinic_id ORDER BY lower(n.valid_during) DESC LIMIT 1) AS clinic,
            (SELECT n.name FROM core.treatment_name n WHERE n.treatment_id = e.treatment_id ORDER BY lower(n.valid_during) DESC LIMIT 1) AS treatment,
            e.before, e.after,
            (SELECT r.name FROM core.region r WHERE r.country_id = e.country_id AND r.key = e.before->>'region') AS region_before,
            (SELECT r.name FROM core.region r WHERE r.country_id = e.country_id AND r.key = e.after->>'region') AS region_after
     FROM availability.change_event e
     WHERE e.country_id = $1 AND e.created_at >= $2 AND e.created_at < $3
     ORDER BY e.id`,
    [countryId, day.start, day.end],
  );
  return rows.rows.map((row) => {
    const clinic = row.clinic ?? "";
    const treatment = row.treatment ?? String(row.before?.name ?? row.after?.name ?? "");
    const key = (kind: string) => `email.summary.changeKinds.${kind}`;
    switch (row.kind) {
      case "treatment_renamed":
        return t(key(row.kind), {
          before: String(row.before?.name ?? ""),
          after: String(row.after?.name ?? ""),
        });
      case "clinic_region_changed":
        return t(key(row.kind), { clinic, before: row.region_before ?? "", after: row.region_after ?? "" });
      case "selectable_changed":
        return t(key(row.after?.selectable ? "selectable_on" : "selectable_off"), { clinic, treatment });
      case "epr_activation_changed":
        return t(key(row.after?.activated ? "epr_activation_on" : "epr_activation_off"), {
          clinic,
          treatment,
        });
      case "max_lead_changed":
        return t(key(row.kind), {
          before: Number(row.before?.days ?? 0),
          after: Number(row.after?.days ?? 0),
        });
      default:
        return t(key(row.kind), { clinic, treatment });
    }
  });
}
