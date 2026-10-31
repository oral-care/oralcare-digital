import type { Client } from "pg";

import type { Thresholds } from "@/lib/availability/statuses";

// What a measurement needs from earlier runs, read before anything is fetched
// (plan 6.1). Read-only. Clinics are keyed on their booking-system id (eprId)
// and treatments on the web key, the natural keys both sources use, so the
// registry can be compared without the database's own ids.

export type StoredClinic = {
  id: number;
  eprId: string;
  /** The clinic's slug on the web while it is listed there, otherwise null. */
  slug: string | null;
  name: string | null;
  city: string | null;
  regionKey: string | null;
};

export type StoredTreatment = {
  id: number;
  webKey: string;
  /** Null when the treatment is not in the booking menu. */
  name: string | null;
  slug: string | null;
};

export type StoredOffering = { webSelectable: boolean; eprActivated: boolean };

/** The previous run's values for a pair, for the alerts that need two runs. */
export type PreviousPair = { webOnline: boolean | null; slotsNotOnline: number | null };

export type Context = {
  countryId: number;
  webSourceId: number;
  eprSourceId: number;
  clinics: Map<string, StoredClinic>;
  treatments: Map<string, StoredTreatment>;
  regions: Map<string, number>;
  offerings: Map<string, StoredOffering>;
  procedures: Map<string, Set<string>>;
  shortestLeadMinutes: number | null;
  previousRun: { id: number; maxLeadDays: number | null } | null;
  previousPairs: Map<string, PreviousPair>;
  thresholds: Map<string | null, Thresholds & { id: number }>;
  incidentThreshold: number;
  requestsToday: { web: number; epr: number };
  activationFetchedAt: Date | null;
  dailyValueExists: boolean;
};

export const pairKey = (eprId: string, webKey: string) => `${eprId}|${webKey}`;

export async function loadContext(
  client: Client,
  input: { countryCode: string; point: Date; now: Date; dayStart: Date; day: string },
): Promise<Context> {
  const country = await client.query<{ id: number }>("SELECT id FROM core.country WHERE code = $1", [
    input.countryCode,
  ]);
  const countryId = country.rows[0]?.id;
  if (countryId === undefined) throw new Error(`Market ${input.countryCode} is missing in core.country`);

  const sources = await client.query<{ id: number; key: string }>("SELECT id, key FROM core.source_system");
  const sourceId = (key: string) => {
    const id = sources.rows.find((s) => s.key === key)?.id;
    if (id === undefined) throw new Error(`Source ${key} is missing in core.source_system`);
    return id;
  };
  const webSourceId = sourceId("oralcare_se");
  const eprSourceId = sourceId("muntra");

  const clinics = await client.query<{
    id: number;
    epr_id: string;
    slug: string | null;
    name: string | null;
    city: string | null;
    region_key: string | null;
  }>(
    `SELECT c.id, e.external_id AS epr_id, w.external_id AS slug, n.name, n.city, r.key AS region_key
     FROM core.clinic c
     JOIN core.clinic_external_id e ON e.clinic_id = c.id AND e.source_system_id = $2 AND upper_inf(e.valid_during)
     LEFT JOIN core.clinic_external_id w ON w.clinic_id = c.id AND w.source_system_id = $3 AND upper_inf(w.valid_during)
     LEFT JOIN core.clinic_name n ON n.clinic_id = c.id AND upper_inf(n.valid_during)
     LEFT JOIN core.clinic_region cr ON cr.clinic_id = c.id AND upper_inf(cr.valid_during)
     LEFT JOIN core.region r ON r.id = cr.region_id
     WHERE c.country_id = $1`,
    [countryId, eprSourceId, webSourceId],
  );

  const treatments = await client.query<{
    id: number;
    web_key: string;
    name: string | null;
    slug: string | null;
  }>(
    `SELECT t.id, t.web_key, n.name, n.slug
     FROM core.treatment t
     LEFT JOIN core.treatment_name n ON n.treatment_id = t.id AND upper_inf(n.valid_during)
     WHERE t.country_id = $1`,
    [countryId],
  );

  const regions = await client.query<{ id: number; key: string }>(
    "SELECT id, key FROM core.region WHERE country_id = $1",
    [countryId],
  );

  const offerings = await client.query<{
    epr_id: string;
    web_key: string;
    web_selectable: boolean;
    epr_activated: boolean;
  }>(
    `SELECT e.external_id AS epr_id, t.web_key, o.web_selectable, o.epr_activated
     FROM core.clinic_treatment_offering o
     JOIN core.clinic_external_id e ON e.clinic_id = o.clinic_id AND e.source_system_id = $2 AND upper_inf(e.valid_during)
     JOIN core.treatment t ON t.id = o.treatment_id
     WHERE t.country_id = $1 AND upper_inf(o.valid_during)`,
    [countryId, eprSourceId],
  );

  const procedures = await client.query<{ epr_id: string; web_key: string; procedure_id: string }>(
    `SELECT e.external_id AS epr_id, t.web_key, p.procedure_id
     FROM core.treatment_epr_procedure p
     JOIN core.clinic_external_id e ON e.clinic_id = p.clinic_id AND e.source_system_id = $2 AND upper_inf(e.valid_during)
     JOIN core.treatment t ON t.id = p.treatment_id
     WHERE t.country_id = $1 AND p.source_system_id = $2 AND upper_inf(p.valid_during)`,
    [countryId, eprSourceId],
  );

  // The shortest distance from a request to the first web slot over 7 days (plan 6.3).
  const lead = await client.query<{ minutes: number | null }>(
    `SELECT (extract(epoch FROM min(m.first_free_at - m.requested_at)) / 60)::float8 AS minutes
     FROM availability.measurement m JOIN core.job_run r ON r.id = m.job_run_id
     WHERE r.country_id = $1 AND m.source_system_id = $2 AND m.status = 'measured'
       AND m.first_free_at IS NOT NULL AND m.requested_at > $3::timestamptz - interval '7 days'`,
    [countryId, webSourceId, input.now],
  );

  // The last successful measurement with an earlier schedule point (plan 6.1).
  // Step 1's runs proved the chain without measuring, so they have no maxLeadDays.
  const previous = await client.query<{ id: string; max_lead_days: number | null }>(
    `SELECT id, (details->>'maxLeadDays')::int AS max_lead_days FROM core.job_run
     WHERE job = 'availability' AND country_id = $1 AND status = 'succeeded'
       AND schedule_point < $2 AND details ? 'maxLeadDays'
     ORDER BY schedule_point DESC, id DESC LIMIT 1`,
    [countryId, input.point],
  );
  const previousRow = previous.rows[0];
  const previousRun = previousRow
    ? { id: Number(previousRow.id), maxLeadDays: previousRow.max_lead_days }
    : null;

  const previousPairs = new Map<string, PreviousPair>();
  if (previousRun) {
    const rows = await client.query<{
      epr_id: string;
      web_key: string;
      slots_not_online: number | null;
      web_status: string | null;
      web_slots_14: number | null;
    }>(
      `SELECT e.external_id AS epr_id, t.web_key, c.slots_not_online, m.status AS web_status, m.slots_14 AS web_slots_14
       FROM availability.comparison c
       JOIN core.clinic_external_id e ON e.clinic_id = c.clinic_id AND e.source_system_id = $2 AND upper_inf(e.valid_during)
       JOIN core.treatment t ON t.id = c.treatment_id
       LEFT JOIN availability.measurement m ON m.job_run_id = c.job_run_id AND m.clinic_id = c.clinic_id
         AND m.treatment_id = c.treatment_id AND m.source_system_id = $3
       WHERE c.job_run_id = $1`,
      [previousRun.id, eprSourceId, webSourceId],
    );
    for (const row of rows.rows) {
      const webOnline =
        row.web_status === "measured"
          ? (row.web_slots_14 ?? 0) > 0
          : row.web_status === "not_offered"
            ? false
            : null;
      previousPairs.set(pairKey(row.epr_id, row.web_key), {
        webOnline,
        slotsNotOnline: row.slots_not_online,
      });
    }
  }

  const thresholds = await client.query<{
    id: number;
    treatment_web_key: string | null;
    good_min_slots: number;
    short_max_days: number;
  }>(
    `SELECT DISTINCT ON (treatment_web_key) id, treatment_web_key, good_min_slots, short_max_days
     FROM availability.status_threshold_version
     WHERE country_id = $1 AND valid_from <= now()
     ORDER BY treatment_web_key, valid_from DESC`,
    [countryId],
  );

  const incident = await client.query<{ value: unknown }>(
    `SELECT value FROM core.config_version WHERE key = 'incident_threshold' AND valid_from <= now()
     ORDER BY valid_from DESC LIMIT 1`,
  );
  const incidentThreshold = Number(incident.rows[0]?.value);
  if (!Number.isFinite(incidentThreshold))
    throw new Error("incident_threshold is missing in core.config_version");

  // The day's requests and the last activation read, by the runs' own window
  // start, which follows the run's clock (plan 6.6).
  const usage = await client.query<{ web: string; epr: string; activation: Date | null }>(
    `SELECT coalesce(sum((details->'requests'->>'web')::int) FILTER (WHERE window_start >= $2), 0) AS web,
            coalesce(sum((details->'requests'->>'epr')::int) FILTER (WHERE window_start >= $2), 0) AS epr,
            max(window_start) FILTER (WHERE status = 'succeeded' AND details->>'activationFetched' = 'true') AS activation
     FROM core.job_run WHERE job = 'availability' AND country_id = $1`,
    [countryId, input.dayStart],
  );

  const daily = await client.query(
    `SELECT 1 FROM availability.daily_value d JOIN core.treatment t ON t.id = d.treatment_id
     WHERE t.country_id = $1 AND d.day = $2::date LIMIT 1`,
    [countryId, input.day],
  );

  return {
    countryId,
    webSourceId,
    eprSourceId,
    clinics: new Map(
      clinics.rows.map((r) => [
        r.epr_id,
        { id: r.id, eprId: r.epr_id, slug: r.slug, name: r.name, city: r.city, regionKey: r.region_key },
      ]),
    ),
    treatments: new Map(
      treatments.rows.map((r) => [r.web_key, { id: r.id, webKey: r.web_key, name: r.name, slug: r.slug }]),
    ),
    regions: new Map(regions.rows.map((r) => [r.key, r.id])),
    offerings: new Map(
      offerings.rows.map((r) => [
        pairKey(r.epr_id, r.web_key),
        { webSelectable: r.web_selectable, eprActivated: r.epr_activated },
      ]),
    ),
    procedures: procedures.rows.reduce((map, r) => {
      const key = pairKey(r.epr_id, r.web_key);
      return map.set(key, (map.get(key) ?? new Set<string>()).add(r.procedure_id));
    }, new Map<string, Set<string>>()),
    shortestLeadMinutes: lead.rows[0]?.minutes ?? null,
    previousRun,
    previousPairs,
    thresholds: new Map(
      thresholds.rows.map((r) => [
        r.treatment_web_key,
        { id: r.id, goodMinSlots: r.good_min_slots, shortMaxDays: r.short_max_days },
      ]),
    ),
    incidentThreshold,
    requestsToday: { web: Number(usage.rows[0]?.web ?? 0), epr: Number(usage.rows[0]?.epr ?? 0) },
    activationFetchedAt: usage.rows[0]?.activation ?? null,
    dailyValueExists: (daily.rowCount ?? 0) > 0,
  };
}
