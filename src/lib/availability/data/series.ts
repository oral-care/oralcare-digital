import "server-only";

import { CHANGE_COLUMNS, changeLine, type ChangeRow } from "@/lib/availability/changes";
import type { DayRange } from "@/lib/availability/filters";
import { appPool } from "@/lib/db/app";
import { addDays, zonedDay, zonedDayStart } from "@/lib/time";

import type { MarketData } from "./market";

// The charts' data (plan 4.4, 4.6 and 5.5): the daily values on oralcare.se
// summed per day, for each treatment or each clinic, and the changes in the
// offering per day. Treatments are never summed with each other. A day where
// any clinic in the sum could not be measured has no sum, so it is a gap and
// never a drop (plan 5.7). Only clinics on oralcare.se and treatments in the
// booking menu count (plan 5.8).

/** Slots per key (a treatment or clinic id) and day; null when some clinic could not be measured. */
export type DailySums = Map<number, Map<string, number | null>>;

export async function dailySums(
  data: MarketData,
  range: DayRange,
  input: { by: "treatment" | "clinic"; clinics: number[] | null; treatments: number[] | null },
): Promise<DailySums> {
  const column = input.by === "treatment" ? "d.treatment_id" : "d.clinic_id";
  const rows = await appPool().query<{ day: string; key: number; slots: number | null }>(
    `SELECT d.day::text AS day, ${column} AS key,
            CASE WHEN bool_or(d.status = 'could_not_be_measured') THEN NULL
                 ELSE sum(d.slots_14) FILTER (WHERE d.status = 'measured') END::int AS slots
     FROM availability.daily_value d
     WHERE d.source_system_id = $1 AND d.status IN ('measured', 'could_not_be_measured')
       AND d.day BETWEEN $2::date AND $3::date
       AND d.clinic_id = ANY($4::int[]) AND d.treatment_id = ANY($5::int[])
     GROUP BY d.day, ${column}`,
    [
      data.webSourceId,
      range.from,
      range.to,
      input.clinics ?? data.clinics.map((c) => c.id),
      input.treatments ?? data.treatments.map((t) => t.id),
    ],
  );
  const sums: DailySums = new Map();
  for (const row of rows.rows) {
    const days = sums.get(row.key) ?? new Map<string, number | null>();
    days.set(row.day, row.slots);
    sums.set(row.key, days);
  }
  return sums;
}

/** One value per day, null on days without a daily value or with one that could not be measured. */
export function valuesFor(sums: Map<string, number | null> | undefined, days: string[]): (number | null)[] {
  return days.map((day) => sums?.get(day) ?? null);
}

/** The days a clinic was measured on oralcare.se, with nothing that could not be measured (plan 4.6). */
export async function measuredDays(
  data: MarketData,
  range: DayRange,
  clinicId: number,
): Promise<Set<string>> {
  const rows = await appPool().query<{ day: string }>(
    `SELECT d.day::text AS day
     FROM availability.daily_value d
     WHERE d.clinic_id = $1 AND d.source_system_id = $2 AND d.day BETWEEN $3::date AND $4::date
     GROUP BY d.day
     HAVING NOT bool_or(d.status = 'could_not_be_measured')`,
    [clinicId, data.webSourceId, range.from, range.to],
  );
  return new Set(rows.rows.map((r) => r.day));
}

/**
 * The changes in the offering per day in the period (plan 6.5). A change
 * belongs to the filter when its clinic and treatment are in it, or when it
 * concerns the whole market or a whole treatment.
 */
export async function changesByDay(
  data: MarketData,
  range: DayRange,
  input: { clinics: number[] | null; treatments: number[] | null; onlyClinic?: number },
): Promise<{ day: string; lines: string[] }[]> {
  const rows = await appPool().query<ChangeRow & { created_at: Date }>(
    `SELECT e.created_at, ${CHANGE_COLUMNS}
     FROM availability.change_event e
     WHERE e.country_id = $1 AND e.created_at >= $2 AND e.created_at < $3
       AND ($4::int IS NULL OR e.clinic_id = $4)
       AND ($5::int[] IS NULL OR e.clinic_id IS NULL OR e.clinic_id = ANY($5::int[]))
       AND ($6::int[] IS NULL OR e.treatment_id IS NULL OR e.treatment_id = ANY($6::int[]))
     ORDER BY e.id`,
    [
      data.countryId,
      zonedDayStart(range.from, data.timeZone),
      zonedDayStart(addDays(range.to, 1), data.timeZone),
      input.onlyClinic ?? null,
      input.clinics,
      input.treatments,
    ],
  );
  const byDay = new Map<string, string[]>();
  for (const row of rows.rows) {
    const day = zonedDay(row.created_at, data.timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), changeLine(row)]);
  }
  return [...byDay].map(([day, lines]) => ({ day, lines }));
}
