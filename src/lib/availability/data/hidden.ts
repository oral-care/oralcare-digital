import "server-only";

import { webState } from "@/lib/availability/figures";
import { appPool } from "@/lib/db/app";
import { zonedDay } from "@/lib/time";

import type { MarketData } from "./market";
import { latestPairs } from "./snapshot";

// Patient vs Muntra (plan 4.7): the pairs where the latest measurement found
// free slots in Muntra that patients can't book on oralcare.se, and the first
// day the difference was measured without a break since.

export type HiddenRow = {
  clinicId: number;
  treatmentId: number;
  /** Free slots on oralcare.se within 14 days; null when the treatment is not online. */
  onSite: number | null;
  /** When it isn't online but has a later slot: the first slot's day, YYYY-MM-DD (plan 4.7). */
  firstSlot: string | null;
  /** When a measurement before the change found nothing in the days it searched (plan 5.1). */
  noneIn: number | null;
  inMuntra: number | null;
  /** The first day of the difference, YYYY-MM-DD. */
  since: string | null;
};

export async function hiddenSlots(data: MarketData): Promise<HiddenRow[]> {
  const pairs = (await latestPairs(data)).filter((p) => (p.slotsNotOnline ?? 0) > 0);
  if (pairs.length === 0 || !data.latest) return [];
  // The runs since the last one without a difference. A run that couldn't
  // compare the pair (null) doesn't break it. The latest run's start is read
  // in the database: it has microseconds, which a JavaScript Date drops, and
  // the rounded time would leave the latest run out.
  const since = await appPool().query<{ clinic_id: number; treatment_id: number; since: Date }>(
    `WITH pair AS (
       SELECT * FROM unnest($1::int[], $2::int[]) AS p(clinic_id, treatment_id)
     ), history AS (
       SELECT x.clinic_id, x.treatment_id, r.started_at, x.slots_not_online,
              max(r.started_at) FILTER (WHERE x.slots_not_online = 0)
                OVER (PARTITION BY x.clinic_id, x.treatment_id) AS last_zero
       FROM pair p
       JOIN availability.comparison x ON x.clinic_id = p.clinic_id AND x.treatment_id = p.treatment_id
       JOIN core.job_run r ON r.id = x.job_run_id
       WHERE r.status = 'succeeded' AND r.started_at <= (SELECT started_at FROM core.job_run WHERE id = $3)
     )
     SELECT clinic_id, treatment_id, min(started_at) AS since
     FROM history
     WHERE slots_not_online > 0 AND (last_zero IS NULL OR started_at > last_zero)
     GROUP BY clinic_id, treatment_id`,
    [pairs.map((p) => p.clinicId), pairs.map((p) => p.treatmentId), data.latest.runId],
  );
  const sinceOf = new Map(
    since.rows.map((r) => [`${r.clinic_id}|${r.treatment_id}`, zonedDay(r.since, data.timeZone)]),
  );
  return pairs.map((p) => ({
    clinicId: p.clinicId,
    treatmentId: p.treatmentId,
    onSite: webState(p) === "online" ? (p.web?.slots14 ?? null) : null,
    firstSlot: webState(p) === "later" ? (p.web?.firstFreeDate ?? null) : null,
    noneIn: webState(p) === "noneInWindow" ? (p.web?.searchedDays ?? null) : null,
    inMuntra: p.epr?.slots14 ?? null,
    since: sinceOf.get(`${p.clinicId}|${p.treatmentId}`) ?? null,
  }));
}
