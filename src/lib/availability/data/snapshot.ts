import "server-only";

import { cache } from "react";

import { dayIndex } from "@/lib/availability/compare";
import {
  withStatuses,
  type MeasurementStatus,
  type PairValue,
  type WebValue,
} from "@/lib/availability/figures";
import type { Availability, Thresholds, WaitingTime } from "@/lib/availability/statuses";
import { appPool } from "@/lib/db/app";

import type { MarketData } from "./market";

// The values per clinic and treatment that the cards and tables show (plan
// 5.5): the latest successful measurement for today, with today's thresholds,
// or a day's daily values for a period that ends earlier, with the statuses
// they were saved with. Slots not online come from the same run's comparison.

type Row = {
  clinic_id: number;
  treatment_id: number;
  source_system_id: number;
  status: MeasurementStatus;
  slots_14: number | null;
  slots_30: number | null;
  first_free_at: Date | null;
  first_free_days: number | null;
  availability: Availability | null;
  waiting_time: WaitingTime | null;
  slots_not_online: number | null;
};

function pairs(data: MarketData, rows: Row[], web: (row: Row) => WebValue): PairValue[] {
  const byPair = new Map<string, PairValue>();
  for (const row of rows) {
    const key = `${row.clinic_id}|${row.treatment_id}`;
    const pair = byPair.get(key) ?? {
      clinicId: row.clinic_id,
      treatmentId: row.treatment_id,
      web: null,
      epr: null,
      slotsNotOnline: row.slots_not_online,
    };
    if (row.source_system_id === data.webSourceId) pair.web = web(row);
    if (row.source_system_id === data.eprSourceId) pair.epr = { status: row.status, slots14: row.slots_14 };
    byPair.set(key, pair);
  }
  return [...byPair.values()];
}

/** The latest successful measurement, with the thresholds that apply now. */
export const latestPairs = cache(async (data: MarketData): Promise<PairValue[]> => {
  const latest = data.latest;
  if (!latest) return [];
  const pool = appPool();
  const [rows, thresholds] = await Promise.all([
    pool.query<Row>(
      `SELECT m.clinic_id, m.treatment_id, m.source_system_id, m.status, m.slots_14, m.slots_30,
              m.first_free_at, NULL::int AS first_free_days, NULL AS availability, NULL AS waiting_time,
              x.slots_not_online
       FROM availability.measurement m
       LEFT JOIN availability.comparison x
         ON x.job_run_id = m.job_run_id AND x.clinic_id = m.clinic_id AND x.treatment_id = m.treatment_id
       WHERE m.job_run_id = $1`,
      [latest.runId],
    ),
    pool.query<{ treatment_web_key: string | null; good_min_slots: number; short_max_days: number }>(
      `SELECT DISTINCT ON (coalesce(v.treatment_web_key, '')) v.treatment_web_key, v.good_min_slots, v.short_max_days
       FROM availability.status_threshold_version v
       WHERE v.country_id = $1 AND v.valid_from <= now()
       ORDER BY coalesce(v.treatment_web_key, ''), v.valid_from DESC`,
      [data.countryId],
    ),
  ]);
  const byKey = new Map<string | null, Thresholds>(
    thresholds.rows.map((r) => [
      r.treatment_web_key,
      { goodMinSlots: r.good_min_slots, shortMaxDays: r.short_max_days },
    ]),
  );
  const webKeys = new Map(data.treatments.map((t) => [t.id, t.webKey]));
  return pairs(data, rows.rows, (row) => {
    const web = {
      status: row.status,
      slots14: row.slots_14,
      slots30: row.slots_30,
      firstFreeDays: row.first_free_at ? dayIndex(latest.startedAt, row.first_free_at, data.timeZone) : null,
    };
    // New treatments get the default thresholds until someone sets their own (plan 5.2).
    const thresholds = byKey.get(webKeys.get(row.treatment_id) ?? null) ?? byKey.get(null);
    return thresholds ? withStatuses(web, thresholds) : { ...web, availability: null, waitingTime: null };
  });
});

/** A day's daily values (plan 5.5), with the statuses they were saved with. */
export const dayPairs = cache(async (data: MarketData, day: string): Promise<PairValue[]> => {
  const rows = await appPool().query<Row>(
    `SELECT d.clinic_id, d.treatment_id, d.source_system_id, d.status, d.slots_14, NULL::int AS slots_30,
            NULL::timestamptz AS first_free_at, d.first_free_days, d.availability, d.waiting_time,
            x.slots_not_online
     FROM availability.daily_value d
     JOIN core.clinic c ON c.id = d.clinic_id
     LEFT JOIN availability.comparison x
       ON x.job_run_id = d.job_run_id AND x.clinic_id = d.clinic_id AND x.treatment_id = d.treatment_id
     WHERE d.day = $1 AND c.country_id = $2`,
    [day, data.countryId],
  );
  return pairs(data, rows.rows, (row) => ({
    status: row.status,
    slots14: row.slots_14,
    slots30: null,
    firstFreeDays: row.first_free_days,
    availability: row.availability,
    waitingTime: row.waiting_time,
  }));
});

/**
 * The values for a period that ends on a day (plan 4.4 and 5.5): the latest
 * measurement when the period ends today, otherwise that day's daily values.
 * The heading is "Today" only when the latest measurement is from today.
 */
export async function snapshotFor(
  data: MarketData,
  day: string,
): Promise<{ pairs: PairValue[]; day: string | null; isToday: boolean }> {
  if (day >= data.today) {
    return {
      pairs: await latestPairs(data),
      day: data.latest?.day ?? null,
      isToday: data.latest?.day === data.today,
    };
  }
  return { pairs: await dayPairs(data, day), day, isToday: false };
}
