import type { Client } from "pg";

import { addDays, STOCKHOLM, zonedDay, zonedDayStart, zonedParts } from "../../src/lib/time";

// Made-up data for the Availability pages (plan 15.3): six clinics in three
// regions and four treatments, a measurement at 08 on each of the last 99
// days with daily values, and the two latest even hours today. Every status
// on the pages appears: Good, Mixed and Low, Short, Mixed and Long, slots not
// online on a treatment that is online and on one that isn't, a clinic with
// nothing online that Muntra has activated, and one with nothing at all. Two
// changes in the offering mark the charts. All names are made up.

const HOUR = 3_600_000;
export const HISTORY_DAYS = 99;

type Pair = {
  /** Free slots on the web within 14 days today; null when the clinic can't be chosen. */
  web: number | null;
  /** Free slots in Muntra within 14 days today; null when nobody has it activated. */
  epr: number | null;
  /** Days to the first slot on the web today. */
  first: number;
  /** Days back the slots not online started, with how many. */
  hidden?: { since: number; slots: number };
};

export const SEED_REGIONS = [
  { key: "norr", name: "Norr" },
  { key: "mitt", name: "Mitt" },
  { key: "syd", name: "Syd" },
] as const;

export const SEED_TREATMENTS = [
  { webKey: "muntra-checkup-1", name: "Undersökning", slug: "undersokning" },
  { webKey: "muntra-treatment-23", name: "Akut", slug: "akut" },
  { webKey: "muntra-treatment-11", name: "Tandhygienist", slug: "tandhygienist" },
  { webKey: "muntra-treatment-9", name: "Tandblekning", slug: "tandblekning" },
] as const;

type TreatmentKey = (typeof SEED_TREATMENTS)[number]["webKey"];

export const SEED_CLINICS: {
  slug: string;
  name: string;
  city: string;
  region: (typeof SEED_REGIONS)[number]["key"];
  pairs: Partial<Record<TreatmentKey, Pair>>;
}[] = [
  {
    slug: "alfa",
    name: "Oral Care Alfa",
    city: "Alfaby",
    region: "norr",
    pairs: {
      "muntra-checkup-1": { web: 40, epr: 40, first: 0 },
      "muntra-treatment-23": { web: 15, epr: 15, first: 0 },
      "muntra-treatment-11": { web: 25, epr: 25, first: 1 },
      "muntra-treatment-9": { web: 30, epr: 30, first: 2 },
    },
  },
  {
    slug: "beta",
    name: "Oral Care Beta",
    city: "Betaby",
    region: "norr",
    pairs: {
      "muntra-checkup-1": { web: 20, epr: 20, first: 1 },
      "muntra-treatment-23": { web: 5, epr: 5, first: 2 },
      "muntra-treatment-11": { web: 12, epr: 12, first: 5 },
    },
  },
  {
    slug: "gamma",
    name: "Oral Care Gamma",
    city: "Gammaby",
    region: "mitt",
    pairs: {
      "muntra-checkup-1": { web: 6, epr: 6, first: 8 },
      "muntra-treatment-23": { web: 3, epr: 3, first: 1 },
    },
  },
  {
    slug: "delta",
    name: "Oral Care Delta",
    city: "Deltaby",
    region: "mitt",
    pairs: {
      "muntra-checkup-1": { web: null, epr: 0, first: 0 },
      "muntra-treatment-23": { web: null, epr: 9, first: 0, hidden: { since: 20, slots: 9 } },
    },
  },
  {
    slug: "epsilon",
    name: "Oral Care Epsilon",
    city: "Epsilonby",
    region: "syd",
    pairs: {
      "muntra-checkup-1": { web: 12, epr: 19, first: 0, hidden: { since: 5, slots: 7 } },
      "muntra-treatment-11": { web: 0, epr: 0, first: 0 },
    },
  },
  { slug: "zeta", name: "Oral Care Zeta", city: "Zetaby", region: "syd", pairs: {} },
];

/** A weekly wave around today's value, never below 1 for a treatment that is online today. */
function slotsOn(pair: Pair, base: number, daysAgo: number): number {
  if (daysAgo === 0 || base === 0) return base;
  const wave = ((daysAgo * 3) % 7) - 3;
  return Math.max(1, base + wave);
}

const status = (slots: number | null) => (slots === null ? "not_offered" : "measured");

export type SeededIds = {
  clinics: Map<string, number>;
  treatments: Map<string, number>;
  latestRunId: number;
};

export async function seedAvailability(client: Client, now: Date = new Date()): Promise<SeededIds> {
  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows[0] as T;
  const { id: countryId } = await one<{ id: number }>("SELECT id FROM core.country WHERE code = 'se'");
  const { id: webId } = await one<{ id: number }>(
    "SELECT id FROM core.source_system WHERE key = 'oralcare_se'",
  );
  const { id: eprId } = await one<{ id: number }>("SELECT id FROM core.source_system WHERE key = 'muntra'");
  const thresholds = new Map(
    (
      await client.query<{
        id: number;
        treatment_web_key: string | null;
        good_min_slots: number;
        short_max_days: number;
      }>(
        "SELECT id, treatment_web_key, good_min_slots, short_max_days FROM availability.status_threshold_version WHERE country_id = $1",
        [countryId],
      )
    ).rows.map((r) => [r.treatment_web_key, r]),
  );
  const since = new Date(now.getTime() - (HISTORY_DAYS + 5) * 24 * HOUR);
  const valid = `tstzrange('${since.toISOString()}', null)`;

  const regionIds = new Map<string, number>();
  for (const region of SEED_REGIONS) {
    const row = await one<{ id: number }>(
      "INSERT INTO core.region (country_id, key, name) VALUES ($1, $2, $3) RETURNING id",
      [countryId, region.key, region.name],
    );
    regionIds.set(region.key, row.id);
  }
  const treatmentIds = new Map<string, number>();
  for (const treatment of SEED_TREATMENTS) {
    const row = await one<{ id: number }>(
      "INSERT INTO core.treatment (country_id, web_key) VALUES ($1, $2) RETURNING id",
      [countryId, treatment.webKey],
    );
    treatmentIds.set(treatment.webKey, row.id);
    await client.query(
      `INSERT INTO core.treatment_name (treatment_id, name, slug, valid_during) VALUES ($1, $2, $3, ${valid})`,
      [row.id, treatment.name, treatment.slug],
    );
  }
  const clinicIds = new Map<string, number>();
  for (const [i, clinic] of SEED_CLINICS.entries()) {
    const row = await one<{ id: number }>("INSERT INTO core.clinic (country_id) VALUES ($1) RETURNING id", [
      countryId,
    ]);
    clinicIds.set(clinic.slug, row.id);
    await client.query(
      `INSERT INTO core.clinic_name (clinic_id, name, city, valid_during) VALUES ($1, $2, $3, ${valid})`,
      [row.id, clinic.name, clinic.city],
    );
    await client.query(
      `INSERT INTO core.clinic_external_id (clinic_id, source_system_id, external_id, valid_during)
       VALUES ($1, $2, $3, ${valid}), ($1, $4, $5, ${valid})`,
      [row.id, webId, clinic.slug, eprId, String(9000 + i)],
    );
    await client.query(
      `INSERT INTO core.clinic_region (clinic_id, region_id, valid_during) VALUES ($1, $2, ${valid})`,
      [row.id, regionIds.get(clinic.region)],
    );
    for (const [webKey, pair] of Object.entries(clinic.pairs)) {
      await client.query(
        `INSERT INTO core.clinic_treatment_offering (clinic_id, treatment_id, web_selectable, epr_activated, valid_during)
         VALUES ($1, $2, $3, $4, ${valid})`,
        [row.id, treatmentIds.get(webKey), pair.web !== null, pair.epr !== null],
      );
    }
  }

  // The runs: 08 on each of the last 99 days, then the two latest even hours.
  const today = zonedDay(now, STOCKHOLM);
  const hour = zonedParts(now, STOCKHOLM).hour;
  const latest = new Date(zonedDayStart(today).getTime() + (hour - (hour % 2)) * HOUR);
  const points: { point: Date; daysAgo: number; latest: boolean }[] = [];
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    points.push({
      point: new Date(zonedDayStart(addDays(today, -daysAgo)).getTime() + 8 * HOUR),
      daysAgo,
      latest: false,
    });
  }
  points.push({ point: new Date(latest.getTime() - 2 * HOUR), daysAgo: 0, latest: true });
  points.push({ point: latest, daysAgo: 0, latest: true });

  let latestRunId = 0;
  const runByDay = new Map<number, number>();
  for (const { point, daysAgo, latest: isLatest } of points) {
    const startedAt = new Date(point.getTime() + 4 * 60_000);
    const run = await one<{ id: number }>(
      `INSERT INTO core.job_run (job, country_id, schedule_point, status, started_at, finished_at, window_start, code_version)
       VALUES ('availability', $1, $2, 'succeeded', $3, $4, $5, 'e2e') RETURNING id`,
      [
        countryId,
        point,
        startedAt,
        new Date(startedAt.getTime() + 60_000),
        new Date(startedAt.getTime() + 30 * 60_000),
      ],
    );
    latestRunId = Number(run.id);
    runByDay.set(daysAgo, latestRunId);
    const day = addDays(today, -daysAgo);
    const measurements: unknown[] = [];
    const comparisons: unknown[] = [];
    const dailyValues: unknown[] = [];
    for (const clinic of SEED_CLINICS) {
      for (const [webKey, pair] of Object.entries(clinic.pairs)) {
        const clinicId = clinicIds.get(clinic.slug);
        const treatmentId = treatmentIds.get(webKey);
        const web = pair.web === null ? null : slotsOn(pair, pair.web, daysAgo);
        const hidden = pair.hidden && daysAgo <= pair.hidden.since ? pair.hidden.slots : 0;
        // Not bookable on the web: Muntra's slots are the ones not online, when there are any.
        const epr =
          pair.epr === null
            ? null
            : pair.web === null
              ? pair.hidden
                ? hidden
                : pair.epr
              : (web ?? 0) + hidden;
        const first = web && web > 0 ? pair.first : null;
        const limits = thresholds.get(webKey) ?? thresholds.get(null)!;
        comparisons.push({
          clinic_id: clinicId,
          treatment_id: treatmentId,
          web_slots: web,
          epr_slots: epr,
          slots_not_online: epr === null ? 0 : hidden,
        });
        if (isLatest) {
          for (const [source, slots] of [
            [webId, web],
            [eprId, epr],
          ] as const) {
            measurements.push({
              clinic_id: clinicId,
              treatment_id: treatmentId,
              source_system_id: source,
              status: status(slots),
              slots_7: slots,
              slots_14: slots,
              slots_30: slots === null ? null : slots * 2,
              first_free_at:
                source === webId && first !== null
                  ? new Date(zonedDayStart(addDays(day, first)).getTime() + 10 * HOUR).toISOString()
                  : null,
            });
          }
        }
        if (!isLatest || point === latest) {
          for (const [source, slots] of [
            [webId, web],
            [eprId, epr],
          ] as const) {
            const online = source === webId && slots !== null && slots > 0;
            dailyValues.push({
              clinic_id: clinicId,
              treatment_id: treatmentId,
              source_system_id: source,
              status: status(slots),
              slots_14: slots,
              first_free_days: source === webId ? first : null,
              availability: online ? (slots >= limits.good_min_slots ? "good" : "low") : null,
              waiting_time:
                online && first !== null ? (first <= limits.short_max_days ? "short" : "long") : null,
              threshold_version_id: limits.id,
            });
          }
        }
      }
    }
    await client.query(
      `INSERT INTO availability.comparison (job_run_id, clinic_id, treatment_id, web_slots, epr_slots, slots_not_online)
       SELECT $1, r.* FROM jsonb_to_recordset($2::jsonb)
         AS r(clinic_id int, treatment_id int, web_slots int, epr_slots int, slots_not_online int)`,
      [latestRunId, JSON.stringify(comparisons)],
    );
    if (measurements.length > 0) {
      await client.query(
        `INSERT INTO availability.measurement (job_run_id, clinic_id, treatment_id, source_system_id, status,
           slots_7, slots_14, slots_30, first_free_at, window_start, window_end)
         SELECT $1, r.*, $3, $4 FROM jsonb_to_recordset($2::jsonb)
           AS r(clinic_id int, treatment_id int, source_system_id smallint, status text, slots_7 int, slots_14 int,
                slots_30 int, first_free_at timestamptz)`,
        [
          latestRunId,
          JSON.stringify(measurements),
          startedAt,
          new Date(startedAt.getTime() + 30 * 24 * HOUR),
        ],
      );
    }
    if (dailyValues.length > 0) {
      await client.query(
        `INSERT INTO availability.daily_value (day, job_run_id, clinic_id, treatment_id, source_system_id, status,
           slots_14, first_free_days, availability, waiting_time, threshold_version_id, code_version)
         SELECT $1::date, $2, r.*, 'e2e' FROM jsonb_to_recordset($3::jsonb)
           AS r(clinic_id int, treatment_id int, source_system_id smallint, status text, slots_14 int,
                first_free_days int, availability text, waiting_time text, threshold_version_id int)`,
        [day, latestRunId, JSON.stringify(dailyValues)],
      );
    }
  }

  // Two changes in the offering: Tandblekning stopped being bookable at
  // Epsilon 3 days ago, and Tandhygienist got its name 12 days ago.
  await client.query(
    `INSERT INTO availability.change_event (country_id, kind, clinic_id, treatment_id, before, after, from_run_id, to_run_id, created_at)
     VALUES ($1, 'selectable_changed', $2, $3, '{"selectable": true}', '{"selectable": false}', $4, $5, $6),
            ($1, 'treatment_renamed', NULL, $7, '{"name": "Tandhygien"}', '{"name": "Tandhygienist"}', $8, $9, $10)`,
    [
      countryId,
      clinicIds.get("epsilon"),
      treatmentIds.get("muntra-treatment-9"),
      runByDay.get(4),
      runByDay.get(3),
      new Date(zonedDayStart(addDays(today, -3)).getTime() + 8 * HOUR + 5 * 60_000),
      treatmentIds.get("muntra-treatment-11"),
      runByDay.get(13),
      runByDay.get(12),
      new Date(zonedDayStart(addDays(today, -12)).getTime() + 8 * HOUR + 5 * 60_000),
    ],
  );
  return { clinics: clinicIds, treatments: treatmentIds, latestRunId };
}
