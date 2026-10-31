import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runAvailability } from "@/jobs/availability/run";
import { runGuard } from "@/jobs/guard/run";
import type { JobEnv } from "@/jobs/runtime/env";

// The step-1 jobs end to end with their own roles: a cron call writes one row
// in the run log, a duplicate call doesn't, and the retry skips a done point.

const urls = inject("databaseUrls");
const env: JobEnv = {
  CRON_SECRET: "0".repeat(64),
  DATABASE_URL_COLLECTOR: urls.oc_collector,
  DATABASE_URL_APP: urls.oc_app,
};
let owner: Client;

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  await owner.connect();
});

afterAll(async () => {
  await owner.end();
});

describe("runAvailability", () => {
  it("logs one run for the 08 point and refuses the duplicate and the retry", async () => {
    const eight = new Date("2026-11-02T07:20:00Z");
    expect(await runAvailability({ market: "se", now: eight, env })).toMatchObject({ status: "succeeded" });
    expect(await runAvailability({ market: "se", now: eight, env })).toEqual({
      status: "not-run",
      reason: "already-succeeded",
    });
    const nine = new Date("2026-11-02T08:05:00Z");
    expect(await runAvailability({ market: "se", now: nine, env })).toEqual({
      status: "not-run",
      reason: "already-succeeded",
    });

    const rows = await owner.query(
      `SELECT r.status, r.is_retry, c.code FROM core.job_run r JOIN core.country c ON c.id = r.country_id
       WHERE r.job = 'availability' AND r.schedule_point = '2026-11-02T07:00:00Z'`,
    );
    expect(rows.rows).toEqual([{ status: "succeeded", is_retry: false, code: "se" }]);
  });

  it("retries a point that never ran", async () => {
    const eleven = new Date("2026-11-02T10:30:00Z");
    expect(await runAvailability({ market: "se", now: eleven, env })).toMatchObject({ status: "succeeded" });
    const rows = await owner.query(
      "SELECT is_retry FROM core.job_run WHERE job = 'availability' AND schedule_point = '2026-11-02T09:00:00Z'",
    );
    expect(rows.rows).toEqual([{ is_retry: true }]);
  });

  it("does nothing at night", async () => {
    expect(await runAvailability({ market: "se", now: new Date("2026-11-02T02:00:00Z"), env })).toEqual({
      status: "nothing-scheduled",
    });
  });
});

describe("runGuard", () => {
  it("runs once a day with the app's role", async () => {
    expect(await runGuard({ now: new Date("2026-11-02T09:15:00Z"), env })).toMatchObject({
      status: "succeeded",
    });
    expect(await runGuard({ now: new Date("2026-11-02T10:15:00Z"), env })).toEqual({
      status: "not-run",
      reason: "already-succeeded",
    });
  });
});
