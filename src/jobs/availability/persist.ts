import type { Client } from "pg";

import type { RunFinish } from "../runtime/lock";
import type { Context } from "./context";
import type { AlertDraft, DailyRow, Evaluation, Source } from "./evaluate";
import type { RegistryWrites } from "./registry";

// Step 8 of a measurement (plan 6.1): everything in one transaction, which
// starts by checking that the lock is still the run's own. If it isn't, nothing
// is written. Rows go in as JSON sets, so a measurement is a handful of
// statements whatever the number of pairs.

export type PersistInput = {
  ctx: Context;
  runId: number;
  marketCode: string;
  /** The day in the market's time zone, for daily values and alert keys. */
  day: string;
  windowStart: Date;
  writes: RegistryWrites;
  evaluation: Evaluation;
  daily: { rows: DailyRow[]; isLate: boolean } | null;
  codeVersion: string;
  finish: Omit<RunFinish, "status">;
};

export async function persist(client: Client, input: PersistInput): Promise<boolean> {
  await client.query("BEGIN");
  try {
    const lock = await client.query(
      `SELECT 1 FROM core.job_run WHERE id = $1 AND status = 'running' AND lease_until > now() FOR UPDATE`,
      [input.runId],
    );
    if (lock.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }

    const ids = await writeRegistry(client, input);
    await writeMeasurements(client, input, ids);
    await writeAlerts(
      client,
      input.ctx.countryId,
      input.runId,
      input.marketCode,
      input.day,
      input.evaluation.alerts,
    );

    const { finish } = input;
    await client.query(
      `UPDATE core.job_run
       SET status = 'succeeded', finished_at = now(), duration_ms = $2, cpu_ms = $3, request_count = $4,
           error_codes = $5, details = $6, window_start = $7
       WHERE id = $1`,
      [
        input.runId,
        finish.durationMs,
        finish.cpuMs,
        finish.requestCount ?? 0,
        finish.errorCodes ?? null,
        finish.details ?? null,
        input.windowStart,
      ],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

type Ids = { clinic: (eprId: string) => number; treatment: (webKey: string) => number };

/** Validity rows end at the transaction's now() and the next one starts there. */
const END_CURRENT = "valid_during = tstzrange(lower(valid_during), now())";

async function writeRegistry(client: Client, input: PersistInput): Promise<Ids> {
  const { ctx, writes, runId } = input;
  const { countryId, webSourceId, eprSourceId } = ctx;
  const json = (value: unknown) => JSON.stringify(value);

  if (writes.regions.length > 0) {
    await client.query(
      `INSERT INTO core.region (country_id, key, name)
       SELECT $1, key, name FROM jsonb_to_recordset($2::jsonb) AS x(key text, name text)
       ON CONFLICT (country_id, key) DO NOTHING`,
      [countryId, json(writes.regions)],
    );
  }
  const regionIds = new Map(
    (
      await client.query<{ id: number; key: string }>(
        "SELECT id, key FROM core.region WHERE country_id = $1",
        [countryId],
      )
    ).rows.map((r) => [r.key, r.id]),
  );
  const regionId = (key: string) => {
    const id = regionIds.get(key);
    if (id === undefined) throw new Error(`Region ${key} is missing`);
    return id;
  };

  // A new clinic is a few rows at once, so its id never has to be matched up afterwards.
  for (const clinic of writes.newClinics) {
    await client.query(
      `WITH c AS (INSERT INTO core.clinic (country_id) VALUES ($1) RETURNING id),
            e AS (INSERT INTO core.clinic_external_id (clinic_id, source_system_id, external_id)
                  SELECT id, $2::smallint, $3::text FROM c UNION ALL SELECT id, $4::smallint, $5::text FROM c),
            n AS (INSERT INTO core.clinic_name (clinic_id, name, city) SELECT id, $6::text, $7::text FROM c)
       INSERT INTO core.clinic_region (clinic_id, region_id) SELECT id, $8::int FROM c`,
      [
        countryId,
        eprSourceId,
        clinic.eprId,
        webSourceId,
        clinic.slug,
        clinic.name,
        clinic.city,
        regionId(clinic.regionKey),
      ],
    );
  }

  const clinicIds = new Map(
    (
      await client.query<{ id: number; epr_id: string }>(
        `SELECT c.id, e.external_id AS epr_id FROM core.clinic c
         JOIN core.clinic_external_id e ON e.clinic_id = c.id AND e.source_system_id = $2 AND upper_inf(e.valid_during)
         WHERE c.country_id = $1`,
        [countryId, eprSourceId],
      )
    ).rows.map((r) => [r.epr_id, r.id]),
  );
  const clinic = (eprId: string) => {
    const id = clinicIds.get(eprId);
    if (id === undefined) throw new Error(`Clinic ${eprId} is missing`);
    return id;
  };

  if (writes.clinicSlugs.length > 0) {
    const rows = writes.clinicSlugs.map((w) => ({ clinic_id: clinic(w.eprId), slug: w.slug }));
    await client.query(
      `UPDATE core.clinic_external_id SET ${END_CURRENT}
       WHERE source_system_id = $1 AND upper_inf(valid_during)
         AND clinic_id IN (SELECT clinic_id FROM jsonb_to_recordset($2::jsonb) AS x(clinic_id int))`,
      [webSourceId, json(rows)],
    );
    await client.query(
      `INSERT INTO core.clinic_external_id (clinic_id, source_system_id, external_id)
       SELECT clinic_id, $1, slug FROM jsonb_to_recordset($2::jsonb) AS x(clinic_id int, slug text) WHERE slug IS NOT NULL`,
      [webSourceId, json(rows)],
    );
  }
  if (writes.clinicNames.length > 0) {
    const rows = writes.clinicNames.map((w) => ({ clinic_id: clinic(w.eprId), name: w.name, city: w.city }));
    await client.query(
      `UPDATE core.clinic_name SET ${END_CURRENT} WHERE upper_inf(valid_during)
         AND clinic_id IN (SELECT clinic_id FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int))`,
      [json(rows)],
    );
    await client.query(
      `INSERT INTO core.clinic_name (clinic_id, name, city)
       SELECT clinic_id, name, city FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int, name text, city text)`,
      [json(rows)],
    );
  }
  if (writes.clinicRegions.length > 0) {
    const rows = writes.clinicRegions.map((w) => ({
      clinic_id: clinic(w.eprId),
      region_id: regionId(w.regionKey),
    }));
    await client.query(
      `UPDATE core.clinic_region SET ${END_CURRENT} WHERE upper_inf(valid_during)
         AND clinic_id IN (SELECT clinic_id FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int))`,
      [json(rows)],
    );
    await client.query(
      `INSERT INTO core.clinic_region (clinic_id, region_id)
       SELECT clinic_id, region_id FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int, region_id int)`,
      [json(rows)],
    );
  }

  if (writes.newTreatments.length > 0) {
    await client.query(
      `WITH t AS (
         INSERT INTO core.treatment (country_id, web_key)
         SELECT $1, web_key FROM jsonb_to_recordset($2::jsonb) AS x(web_key text)
         RETURNING id, web_key)
       INSERT INTO core.treatment_name (treatment_id, name, slug)
       SELECT t.id, x.name, x.slug FROM t JOIN jsonb_to_recordset($2::jsonb) AS x(web_key text, name text, slug text) USING (web_key)`,
      [countryId, json(writes.newTreatments.map((t) => ({ web_key: t.webKey, name: t.name, slug: t.slug })))],
    );
  }
  const treatmentIds = new Map(
    (
      await client.query<{ id: number; web_key: string }>(
        "SELECT id, web_key FROM core.treatment WHERE country_id = $1",
        [countryId],
      )
    ).rows.map((r) => [r.web_key, r.id]),
  );
  const treatment = (webKey: string) => {
    const id = treatmentIds.get(webKey);
    if (id === undefined) throw new Error(`Treatment ${webKey} is missing`);
    return id;
  };

  if (writes.treatmentNames.length > 0) {
    const rows = writes.treatmentNames.map((w) => ({
      treatment_id: treatment(w.webKey),
      name: w.name,
      slug: w.slug,
    }));
    await client.query(
      `UPDATE core.treatment_name SET ${END_CURRENT} WHERE upper_inf(valid_during)
         AND treatment_id IN (SELECT treatment_id FROM jsonb_to_recordset($1::jsonb) AS x(treatment_id int))`,
      [json(rows)],
    );
    await client.query(
      `INSERT INTO core.treatment_name (treatment_id, name, slug)
       SELECT treatment_id, name, slug FROM jsonb_to_recordset($1::jsonb) AS x(treatment_id int, name text, slug text)
       WHERE name IS NOT NULL`,
      [json(rows)],
    );
  }

  if (writes.offerings.length > 0) {
    const rows = writes.offerings.map((w) => ({
      clinic_id: clinic(w.eprId),
      treatment_id: treatment(w.webKey),
      web_selectable: w.webSelectable,
      epr_activated: w.eprActivated,
    }));
    await client.query(
      `UPDATE core.clinic_treatment_offering o SET ${END_CURRENT}
       FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int, treatment_id int)
       WHERE o.clinic_id = x.clinic_id AND o.treatment_id = x.treatment_id AND upper_inf(o.valid_during)`,
      [json(rows)],
    );
    await client.query(
      `INSERT INTO core.clinic_treatment_offering (clinic_id, treatment_id, web_selectable, epr_activated)
       SELECT clinic_id, treatment_id, web_selectable, epr_activated
       FROM jsonb_to_recordset($1::jsonb) AS x(clinic_id int, treatment_id int, web_selectable boolean, epr_activated boolean)
       WHERE web_selectable OR epr_activated`,
      [json(rows)],
    );
  }

  if (writes.procedures.length > 0) {
    await client.query(
      `INSERT INTO core.treatment_epr_procedure (clinic_id, treatment_id, source_system_id, procedure_id)
       SELECT clinic_id, treatment_id, $1, procedure_id
       FROM jsonb_to_recordset($2::jsonb) AS x(clinic_id int, treatment_id int, procedure_id text)`,
      [
        eprSourceId,
        json(
          writes.procedures.map((w) => ({
            clinic_id: clinic(w.eprId),
            treatment_id: treatment(w.webKey),
            procedure_id: w.procedureId,
          })),
        ),
      ],
    );
  }

  if (writes.events.length > 0) {
    await client.query(
      `INSERT INTO availability.change_event (country_id, kind, clinic_id, treatment_id, before, after, from_run_id, to_run_id, epr_slots)
       SELECT $1, kind, clinic_id, treatment_id, before, after, $2, $3, epr_slots
       FROM jsonb_to_recordset($4::jsonb)
         AS x(kind text, clinic_id int, treatment_id int, before jsonb, after jsonb, epr_slots int)`,
      [
        countryId,
        ctx.previousRun?.id ?? null,
        runId,
        json(
          writes.events.map((e) => ({
            kind: e.kind,
            clinic_id: e.eprId === null ? null : clinic(e.eprId),
            treatment_id: e.webKey === null ? null : treatment(e.webKey),
            before: e.before,
            after: e.after,
            epr_slots: e.eprSlots,
          })),
        ),
      ],
    );
  }

  return { clinic, treatment };
}

async function writeMeasurements(client: Client, input: PersistInput, ids: Ids): Promise<void> {
  const { ctx, runId, evaluation } = input;
  const json = (value: unknown) => JSON.stringify(value);
  const sourceId = (source: Source) => (source === "web" ? ctx.webSourceId : ctx.eprSourceId);
  const pairIds = (pair: { eprId: string; webKey: string }) => ({
    clinic_id: ids.clinic(pair.eprId),
    treatment_id: ids.treatment(pair.webKey),
  });
  const pgArray = (values: number[]) => `{${values.join(",")}}`;

  if (evaluation.measurements.length > 0) {
    await client.query(
      `INSERT INTO availability.measurement
         (job_run_id, clinic_id, treatment_id, source_system_id, status, reason, slots_7, slots_14, slots_30,
          first_free_at, caregivers_activated, window_start, window_end, requested_at, responded_at)
       SELECT $1, clinic_id, treatment_id, source_system_id, status, reason, slots_7, slots_14, slots_30,
              first_free_at, caregivers_activated, window_start, window_end, requested_at, responded_at
       FROM jsonb_to_recordset($2::jsonb) AS x(
         clinic_id int, treatment_id int, source_system_id smallint, status text, reason text,
         slots_7 int, slots_14 int, slots_30 int, first_free_at timestamptz, caregivers_activated int,
         window_start timestamptz, window_end timestamptz, requested_at timestamptz, responded_at timestamptz)`,
      [
        runId,
        json(
          evaluation.measurements.map((m) => ({
            ...pairIds(m.pair),
            source_system_id: sourceId(m.source),
            status: m.status,
            reason: m.reason,
            slots_7: m.slots7,
            slots_14: m.slots14,
            slots_30: m.slots30,
            first_free_at: m.firstFreeAt,
            caregivers_activated: m.caregiversActivated,
            window_start: m.windowStart,
            window_end: m.windowEnd,
            requested_at: m.requestedAt,
            responded_at: m.respondedAt,
          })),
        ),
      ],
    );
    const lists = evaluation.measurements.filter((m) => m.startMinutes !== null);
    if (lists.length > 0) {
      await client.query(
        `INSERT INTO availability.slot_list (job_run_id, clinic_id, treatment_id, source_system_id, start_minutes)
         SELECT $1, clinic_id, treatment_id, source_system_id, start_minutes::integer[]
         FROM jsonb_to_recordset($2::jsonb) AS x(clinic_id int, treatment_id int, source_system_id smallint, start_minutes text)`,
        [
          runId,
          json(
            lists.map((m) => ({
              ...pairIds(m.pair),
              source_system_id: sourceId(m.source),
              start_minutes: pgArray(m.startMinutes ?? []),
            })),
          ),
        ],
      );
    }
  }

  if (evaluation.comparisons.length > 0) {
    await client.query(
      `INSERT INTO availability.comparison (job_run_id, clinic_id, treatment_id, web_slots, epr_slots, slots_not_online)
       SELECT $1, clinic_id, treatment_id, web_slots, epr_slots, slots_not_online
       FROM jsonb_to_recordset($2::jsonb)
         AS x(clinic_id int, treatment_id int, web_slots int, epr_slots int, slots_not_online int)`,
      [
        runId,
        json(
          evaluation.comparisons.map((c) => ({
            ...pairIds(c.pair),
            web_slots: c.webSlots,
            epr_slots: c.eprSlots,
            slots_not_online: c.slotsNotOnline,
          })),
        ),
      ],
    );
  }

  if (evaluation.incident) {
    await client.query("INSERT INTO availability.site_incident (job_run_id, share_missing) VALUES ($1, $2)", [
      runId,
      evaluation.incident.shareMissing.toFixed(4),
    ]);
  }

  // Daily values are upserted (plan 10.4): the fallback at 10 only writes when 08 and 09 wrote nothing.
  if (input.daily && input.daily.rows.length > 0) {
    const written = await client.query<{
      id: string;
      clinic_id: number;
      treatment_id: number;
      source_system_id: number;
    }>(
      `INSERT INTO availability.daily_value
         (day, clinic_id, treatment_id, source_system_id, job_run_id, is_late, status, slots_14, first_free_days,
          availability, waiting_time, threshold_version_id, code_version)
       SELECT $1::date, clinic_id, treatment_id, source_system_id, $2, $3, status, slots_14, first_free_days,
              availability, waiting_time, threshold_version_id, $4
       FROM jsonb_to_recordset($5::jsonb) AS x(
         clinic_id int, treatment_id int, source_system_id smallint, status text, slots_14 int, first_free_days int,
         availability text, waiting_time text, threshold_version_id int)
       ON CONFLICT (day, clinic_id, treatment_id, source_system_id) DO UPDATE SET
         job_run_id = excluded.job_run_id, is_late = excluded.is_late, status = excluded.status,
         slots_14 = excluded.slots_14, first_free_days = excluded.first_free_days,
         availability = excluded.availability, waiting_time = excluded.waiting_time,
         threshold_version_id = excluded.threshold_version_id, code_version = excluded.code_version
       RETURNING id, clinic_id, treatment_id, source_system_id`,
      [
        input.day,
        runId,
        input.daily.isLate,
        input.codeVersion,
        json(
          input.daily.rows.map((d) => ({
            ...pairIds(d.pair),
            source_system_id: sourceId(d.source),
            status: d.status,
            slots_14: d.slots14,
            first_free_days: d.firstFreeDays,
            availability: d.availability,
            waiting_time: d.waitingTime,
            threshold_version_id: d.thresholdVersionId,
          })),
        ),
      ],
    );
    const dailyId = new Map(
      written.rows.map((r) => [`${r.clinic_id}:${r.treatment_id}:${r.source_system_id}`, Number(r.id)]),
    );
    await client.query(
      `INSERT INTO availability.daily_slot_list (daily_value_id, start_minutes)
       SELECT daily_value_id, start_minutes::integer[]
       FROM jsonb_to_recordset($1::jsonb) AS x(daily_value_id bigint, start_minutes text)
       ON CONFLICT (daily_value_id) DO UPDATE SET start_minutes = excluded.start_minutes`,
      [
        json(
          input.daily.rows.map((d) => {
            const { clinic_id, treatment_id } = pairIds(d.pair);
            return {
              daily_value_id: dailyId.get(`${clinic_id}:${treatment_id}:${sourceId(d.source)}`),
              start_minutes: pgArray(d.startMinutes),
            };
          }),
        ),
      ],
    );
  }
}

/** Saved as pending, so a failed send is picked up later; the key makes an event alert once (plan 8.1). */
export async function writeAlerts(
  client: Client,
  countryId: number | null,
  runId: number | null,
  marketCode: string,
  day: string,
  alerts: AlertDraft[],
): Promise<void> {
  const rows = new Map(
    alerts.map((a) => {
      const key = `${a.type}:${marketCode}:${a.subject}:${day}`;
      return [key, { dedupe_key: key, type: a.type, payload: a.payload }];
    }),
  );
  if (rows.size === 0) return;
  await client.query(
    `INSERT INTO core.alert (dedupe_key, type, country_id, job_run_id, payload)
     SELECT dedupe_key, type, $1, $2, payload FROM jsonb_to_recordset($3::jsonb) AS x(dedupe_key text, type text, payload jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [countryId, runId, JSON.stringify([...rows.values()])],
  );
}
