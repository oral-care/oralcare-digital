import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runAvailability } from "@/jobs/availability/run";
import type { JobEnv } from "@/jobs/runtime/env";
import { SourceFormatError } from "@/lib/availability/sources/oralcare-se";

import {
  CHECKUP,
  clockAt,
  FakeEpr,
  FakeWeb,
  fixtureActivation,
  fixtureEprSlots,
  fixtureRegistry,
  fixtureWebSlots,
  SLOT_CLINIC,
  WHITENING,
} from "../support/fake-sources";

// Whole measurements against Postgres with the collector's own role, played out
// over one Swedish day (CET, UTC+1) with sources built from the recorded
// answers, whose slots start on 9 November, after every window here. The first
// run fills the registry; later runs change the offering, lose slots on the
// web, hit an incident, fail a retry and lose the registry.

const urls = inject("databaseUrls");
const env: JobEnv = {
  CRON_SECRET: "0".repeat(64),
  DATABASE_URL_COLLECTOR: urls.oc_collector,
  DATABASE_URL_APP: urls.oc_app,
};
const web = new FakeWeb();
const epr = new FakeEpr();
const runIds: Record<string, number> = {};
let owner: Client;

async function run(iso: string) {
  const now = new Date(iso);
  const outcome = await runAvailability({
    market: "se",
    now,
    env,
    deps: { sources: { web, epr }, clock: clockAt(now) },
  });
  if ("runId" in outcome) runIds[iso] = outcome.runId;
  return outcome;
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await owner.query(sql, params)).rows as T[];
}

const PAIR = `
  JOIN core.clinic_external_id e ON e.clinic_id = x.clinic_id AND upper_inf(e.valid_during)
    AND e.source_system_id = (SELECT id FROM core.source_system WHERE key = 'muntra')
  JOIN core.treatment t ON t.id = x.treatment_id`;

async function measurement(runId: number, eprId: string, webKey: string, source: "oralcare_se" | "muntra") {
  const [row] = await rows<{
    status: string;
    reason: string | null;
    slots_14: number | null;
    caregivers_activated: number | null;
  }>(
    `SELECT x.status, x.reason, x.slots_14, x.caregivers_activated FROM availability.measurement x ${PAIR}
     JOIN core.source_system s ON s.id = x.source_system_id
     WHERE x.job_run_id = $1 AND e.external_id = $2 AND t.web_key = $3 AND s.key = $4`,
    [runId, eprId, webKey, source],
  );
  return row;
}

async function comparison(runId: number, eprId: string, webKey: string) {
  const [row] = await rows<{
    web_slots: number | null;
    epr_slots: number | null;
    slots_not_online: number | null;
  }>(
    `SELECT x.web_slots, x.epr_slots, x.slots_not_online FROM availability.comparison x ${PAIR}
     WHERE x.job_run_id = $1 AND e.external_id = $2 AND t.web_key = $3`,
    [runId, eprId, webKey],
  );
  return row;
}

const alertTypes = async (runId: number) =>
  (
    await rows<{ type: string }>("SELECT type FROM core.alert WHERE job_run_id = $1 ORDER BY type", [runId])
  ).map((r) => r.type);

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  await owner.connect();
  // Other test files share the database. This one starts from an empty registry and run log.
  await owner.query("TRUNCATE core.job_run, core.alert, core.clinic, core.treatment, core.region CASCADE");
  web.slots.set(`${SLOT_CLINIC}|${CHECKUP}`, fixtureWebSlots());
  epr.slots.set(`${SLOT_CLINIC}|1`, fixtureEprSlots());
  epr.activation.set(SLOT_CLINIC, fixtureActivation());
});

afterAll(async () => {
  await owner.end();
});

describe("a day of measurements", () => {
  const registry = fixtureRegistry();
  const checkupClinics = registry.selectable.get(CHECKUP)!.map((c) => c.eprId);
  const whiteningClinics = registry.selectable.get(WHITENING)!.map((c) => c.eprId);

  it("fills the registry at 08, measures both sources and writes the daily value", async () => {
    expect(await run("2026-11-06T07:10:00Z")).toMatchObject({ status: "succeeded" });
    const runId = runIds["2026-11-06T07:10:00Z"]!;

    const listed = new Set(
      [...registry.clinics, ...[...registry.selectable.values()].flat()].map((c) => c.eprId),
    );
    const [counts] = await rows<{ clinics: number; slugs: number; treatments: number }>(
      `SELECT (SELECT count(*)::int FROM core.clinic) AS clinics,
              (SELECT count(*)::int FROM core.clinic_external_id e JOIN core.source_system s ON s.id = e.source_system_id
                WHERE s.key = 'oralcare_se' AND upper_inf(e.valid_during)) AS slugs,
              (SELECT count(*)::int FROM core.treatment_name WHERE upper_inf(valid_during)) AS treatments`,
    );
    expect(counts).toEqual({
      clinics: listed.size,
      slugs: listed.size,
      treatments: registry.treatments.length,
    });

    const webSlots = fixtureWebSlots().length;
    expect(await measurement(runId, SLOT_CLINIC, CHECKUP, "oralcare_se")).toMatchObject({
      status: "measured",
      slots_14: webSlots,
    });
    const booking = await measurement(runId, SLOT_CLINIC, CHECKUP, "muntra");
    expect(booking).toMatchObject({ status: "measured", slots_14: webSlots });
    expect(booking?.caregivers_activated).toBeGreaterThan(0);
    expect(await comparison(runId, SLOT_CLINIC, CHECKUP)).toEqual({
      web_slots: webSlots,
      epr_slots: webSlots,
      slots_not_online: 0,
    });

    // No slots and nobody activated: not offered in the booking system, never 0 (plan 6.4).
    const other = checkupClinics[1]!;
    expect(await measurement(runId, other, CHECKUP, "oralcare_se")).toMatchObject({
      status: "measured",
      slots_14: 0,
    });
    expect(await measurement(runId, other, CHECKUP, "muntra")).toMatchObject({
      status: "not_offered",
      slots_14: null,
    });

    // The activation list adds pairs that are activated but not on the web, measured from the next run.
    const [akut] = await rows<{ web_selectable: boolean; epr_activated: boolean }>(
      `SELECT x.web_selectable, x.epr_activated FROM core.clinic_treatment_offering x ${PAIR}
       WHERE e.external_id = $1 AND t.web_key = 'muntra-treatment-23' AND upper_inf(x.valid_during)`,
      [SLOT_CLINIC],
    );
    expect(akut).toEqual({ web_selectable: false, epr_activated: true });

    const [daily] = await rows<{ values: number; late: number; measurements: number }>(
      `SELECT count(*)::int AS values, count(*) FILTER (WHERE is_late)::int AS late,
              (SELECT count(*)::int FROM availability.measurement WHERE job_run_id = $1) AS measurements
       FROM availability.daily_value WHERE day = '2026-11-06'`,
      [runId],
    );
    expect(daily).toEqual({ values: daily!.measurements, late: 0, measurements: daily!.measurements });
    const [kept] = await rows<{ minutes: number }>(
      `SELECT cardinality(l.start_minutes) AS minutes FROM availability.daily_slot_list l
       JOIN availability.daily_value x ON x.id = l.daily_value_id ${PAIR}
       JOIN core.source_system s ON s.id = x.source_system_id
       WHERE x.day = '2026-11-06' AND e.external_id = $1 AND t.web_key = $2 AND s.key = 'oralcare_se'`,
      [SLOT_CLINIC, CHECKUP],
    );
    expect(kept?.minutes).toBe(webSlots);

    // The first measurement only fills the registry: no changes and no alerts.
    expect(await rows("SELECT 1 FROM availability.change_event")).toHaveLength(0);
    expect(await alertTypes(runId)).toEqual([]);

    const [log] = await rows<{ status: string; window_start: Date | null; details: Record<string, unknown> }>(
      "SELECT status, window_start, details FROM core.job_run WHERE id = $1",
      [runId],
    );
    expect(log?.status).toBe("succeeded");
    expect(log?.window_start).not.toBeNull();
    expect(log?.details).toMatchObject({
      pairs: checkupClinics.length + whiteningClinics.length,
      maxLeadDays: 90,
      leadMinutes: 20,
      activationFetched: true,
      registry: "read",
      dailyValue: true,
      changes: 0,
    });
    const coverage = log?.details.coverage as { measured: number; expected: number };
    expect(coverage.measured).toBe(coverage.expected);
  });

  it("records changes at 10, measures a differing pair twice and saves the difference", async () => {
    const changed = fixtureRegistry();
    changed.selectable.set(CHECKUP, changed.selectable.get(CHECKUP)!.slice(0, 2));
    changed.treatments = changed.treatments.filter((t) => t.internalKey !== WHITENING);
    changed.selectable.delete(WHITENING);
    changed.maxLeadDays = 60;
    web.registry = changed;
    for (const eprId of whiteningClinics) web.slots.set(`${eprId}|${WHITENING}`, "not-found");
    // The web loses 5 slots that the booking system still has.
    web.slots.set(`${SLOT_CLINIC}|${CHECKUP}`, fixtureWebSlots().slice(5));
    const callsBefore = web.calls.length;
    const activationBefore = epr.activationCalls;

    expect(await run("2026-11-06T09:10:00Z")).toMatchObject({ status: "succeeded" });
    const runId = runIds["2026-11-06T09:10:00Z"]!;

    expect(web.calls.slice(callsBefore).filter((c) => c === `${SLOT_CLINIC}|${CHECKUP}`)).toHaveLength(2);
    expect((await comparison(runId, SLOT_CLINIC, CHECKUP))?.slots_not_online).toBe(5);
    expect(await measurement(runId, checkupClinics[2]!, CHECKUP, "oralcare_se")).toMatchObject({
      status: "not_offered",
    });

    const events = await rows<{
      kind: string;
      web_key: string | null;
      before: unknown;
      after: unknown;
      from_run_id: string;
    }>(
      `SELECT x.kind, t.web_key, x.before, x.after, x.from_run_id FROM availability.change_event x
       LEFT JOIN core.treatment t ON t.id = x.treatment_id WHERE x.to_run_id = $1 ORDER BY x.kind, t.web_key`,
      [runId],
    );
    expect(new Set(events.map((e) => e.kind))).toEqual(
      new Set(["max_lead_changed", "selectable_changed", "treatment_removed"]),
    );
    expect(events.find((e) => e.kind === "max_lead_changed")).toMatchObject({
      before: { days: 90 },
      after: { days: 60 },
    });
    expect(events.find((e) => e.kind === "treatment_removed")?.web_key).toBe(WHITENING);
    expect(events.filter((e) => e.kind === "selectable_changed")).toHaveLength(1 + whiteningClinics.length);
    expect(events.every((e) => Number(e.from_run_id) === runIds["2026-11-06T07:10:00Z"])).toBe(true);

    expect(await alertTypes(runId)).toEqual(["max_lead_changed", "treatment_withdrawn"]);
    // The activation list is read once a day, and the daily value was written at 08.
    expect(epr.activationCalls).toBe(activationBefore);
    expect(await rows("SELECT 1 FROM availability.daily_value WHERE job_run_id = $1", [runId])).toHaveLength(
      0,
    );
  });

  it("alerts slots not online after two measurements in a row", async () => {
    expect(await run("2026-11-06T11:10:00Z")).toMatchObject({ status: "succeeded" });
    const runId = runIds["2026-11-06T11:10:00Z"]!;
    const alerts = await rows<{ type: string; status: string; payload: Record<string, unknown> }>(
      "SELECT type, status, payload FROM core.alert WHERE job_run_id = $1",
      [runId],
    );
    expect(alerts).toEqual([
      { type: "slots_not_online", status: "pending", payload: expect.objectContaining({ slots: 5 }) },
    ]);
    // Changes are relative to the previous run, so nothing repeats.
    expect(await rows("SELECT 1 FROM availability.change_event WHERE to_run_id = $1", [runId])).toHaveLength(
      0,
    );
  });

  it("registers an incident when the web shows nothing where the booking system has slots", async () => {
    web.slots.set(`${SLOT_CLINIC}|${CHECKUP}`, []);
    expect(await run("2026-11-06T13:10:00Z")).toMatchObject({ status: "succeeded" });
    const runId = runIds["2026-11-06T13:10:00Z"]!;

    expect(await measurement(runId, SLOT_CLINIC, CHECKUP, "oralcare_se")).toMatchObject({
      status: "could_not_be_measured",
      reason: "incident",
    });
    expect((await comparison(runId, SLOT_CLINIC, CHECKUP))?.slots_not_online).toBeNull();
    expect(
      await rows("SELECT share_missing FROM availability.site_incident WHERE job_run_id = $1", [runId]),
    ).toEqual([{ share_missing: "1.0000" }]);
    expect(await alertTypes(runId)).toEqual(["incident", "low_coverage"]);
  });

  it("logs a failed retry and alerts that the point has no measurement", async () => {
    const broken = {
      now: (): number => {
        throw new Error("clock");
      },
      sleep: async () => undefined,
    };
    const outcome = await runAvailability({
      market: "se",
      now: new Date("2026-11-06T16:10:00Z"),
      env,
      deps: { sources: { web, epr }, clock: broken },
    });
    expect(outcome).toMatchObject({ status: "failed" });
    const runId = (outcome as { runId: number }).runId;
    expect(
      await rows("SELECT status, is_retry, error_codes FROM core.job_run WHERE id = $1", [runId]),
    ).toEqual([{ status: "failed", is_retry: true, error_codes: ["error:Error"] }]);
    expect(await alertTypes(runId)).toEqual(["measurement_failed"]);
  });

  it("measures the stored registry when a registry page changes format, and changes nothing in it", async () => {
    web.registry = new SourceFormatError("oralcare.se /boka", "options", "one menu", "0");
    web.slots.set(`${SLOT_CLINIC}|${CHECKUP}`, fixtureWebSlots());
    expect(await run("2026-11-06T17:10:00Z")).toMatchObject({ status: "succeeded" });
    const runId = runIds["2026-11-06T17:10:00Z"]!;

    expect(await measurement(runId, SLOT_CLINIC, CHECKUP, "oralcare_se")).toMatchObject({
      status: "measured",
    });
    expect(await rows("SELECT 1 FROM availability.change_event WHERE to_run_id = $1", [runId])).toHaveLength(
      0,
    );
    const alerts = await rows<{ type: string; payload: Record<string, unknown> }>(
      "SELECT type, payload FROM core.alert WHERE job_run_id = $1",
      [runId],
    );
    expect(alerts).toEqual([
      {
        type: "format",
        payload: {
          source: "oralcare.se /boka",
          path: "options",
          expected: "one menu",
          received: "0",
          count: 1,
        },
      },
    ]);
    const [log] = await rows<{ details: Record<string, unknown>; error_codes: string[] }>(
      "SELECT details, error_codes FROM core.job_run WHERE id = $1",
      [runId],
    );
    expect(log?.details).toMatchObject({ registry: "format", maxLeadDays: 60 });
    expect(log?.error_codes).toEqual(["registry:format"]);
  });
});
