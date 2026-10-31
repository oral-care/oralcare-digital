import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { acquireLock, finishRun, skipIfSchemaMismatch } from "@/jobs/runtime/lock";
import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";

// The lock in core.job_run, as the collector role uses it (plan 15.2).

const urls = inject("databaseUrls");
let collector: Client;
let owner: Client;

const base = { job: "lock-test", countryId: 1, codeVersion: "test", schemaVersion: 1 };
const point = (hour: number) => new Date(Date.UTC(2026, 10, 2, hour));
const meter = { durationMs: 1, cpuMs: 1 };

beforeAll(async () => {
  collector = new Client({ connectionString: urls.oc_collector });
  owner = new Client({ connectionString: urls.owner });
  await Promise.all([collector.connect(), owner.connect()]);
});

afterAll(async () => {
  await Promise.all([collector.end(), owner.end()]);
});

describe("acquireLock", () => {
  it("gives one run when the same call arrives twice", async () => {
    const second = new Client({ connectionString: urls.oc_collector });
    await second.connect();
    const request = { ...base, point: point(5), isRetry: false };
    const results = await Promise.all([acquireLock(collector, request), acquireLock(second, request)]);
    await second.end();
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    const won = results.find((r) => r.acquired);
    if (won?.acquired) await finishRun(collector, won.runId, { status: "succeeded", ...meter });
  });

  it("does not run a point that already succeeded", async () => {
    const result = await acquireLock(collector, { ...base, point: point(5), isRetry: true });
    expect(result).toEqual({ acquired: false, reason: "already-succeeded" });
  });

  it("ends a call for another point while a run is going", async () => {
    const running = await acquireLock(collector, { ...base, point: point(7), isRetry: false });
    expect(running.acquired).toBe(true);
    const other = await acquireLock(collector, { ...base, point: point(9), isRetry: false });
    expect(other).toEqual({ acquired: false, reason: "other-run-running" });
    const logged = await owner.query(
      "SELECT status, error_codes FROM core.job_run WHERE job = 'lock-test' AND schedule_point = $1",
      [point(9)],
    );
    expect(logged.rows).toEqual([{ status: "deferred", error_codes: ["other_run_running"] }]);
    if (running.acquired) await finishRun(collector, running.runId, { status: "succeeded", ...meter });
  });

  it("takes over a crashed run whose lease has run out, and the old one can't save", async () => {
    const crashed = await acquireLock(collector, { ...base, point: point(11), isRetry: false });
    if (!crashed.acquired) throw new Error("expected the lock");
    await owner.query("UPDATE core.job_run SET lease_until = now() - interval '1 second' WHERE id = $1", [
      crashed.runId,
    ]);

    const retry = await acquireLock(collector, { ...base, point: point(11), isRetry: true });
    expect(retry).toMatchObject({ acquired: true, attempt: 2 });
    expect(await finishRun(collector, crashed.runId, { status: "succeeded", ...meter })).toBe(false);
    if (retry.acquired)
      expect(await finishRun(collector, retry.runId, { status: "succeeded", ...meter })).toBe(true);
  });
});

describe("skipIfSchemaMismatch", () => {
  it("logs a skipped run when the database is older than the code", async () => {
    const request = { job: "lock-test", countryId: 1, point: point(13), isRetry: false, codeVersion: "test" };
    const result = await skipIfSchemaMismatch(collector, request, REQUIRED_SCHEMA + 1);
    expect(result.skipped).toBe(true);
    const logged = await owner.query(
      "SELECT status, error_codes FROM core.job_run WHERE job = 'lock-test' AND schedule_point = $1",
      [point(13)],
    );
    expect(logged.rows).toEqual([{ status: "skipped", error_codes: ["schema_version"] }]);
  });

  it("runs when the database fits", async () => {
    const request = { job: "lock-test", countryId: 1, point: point(15), isRetry: false, codeVersion: "test" };
    expect((await skipIfSchemaMismatch(collector, request, REQUIRED_SCHEMA)).skipped).toBe(false);
  });
});
