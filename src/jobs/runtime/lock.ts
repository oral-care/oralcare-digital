import type { Client } from "pg";

import { schemaFits, type SchemaState } from "@/lib/db/schema-version";

// The lock is a row in core.job_run (plan 7). Two partial unique indexes make
// it safe when Vercel delivers the same call twice: one run per job, market and
// schedule point, and one running run per job and market. A run whose lease has
// run out is marked failed first, so a new attempt can take over.

export const LEASE_SECONDS = 330;

export type LockRequest = {
  job: string;
  countryId: number | null;
  point: Date;
  isRetry: boolean;
  codeVersion: string;
  schemaVersion: number;
};

export type LockResult =
  | { acquired: true; runId: number; attempt: number }
  | { acquired: false; reason: "already-succeeded" | "point-running" | "other-run-running" };

const UNIQUE_VIOLATION = "23505";

export async function readSchemaState(client: Client): Promise<SchemaState> {
  const result = await client.query<{ schema_version: number; min_code_schema: number }>(
    "SELECT schema_version, min_code_schema FROM core.schema_state",
  );
  const row = result.rows[0];
  if (!row) throw new Error("core.schema_state is empty");
  return { schemaVersion: row.schema_version, minCodeSchema: row.min_code_schema };
}

/** Logs a skipped run when the database doesn't fit the code. Returns true if skipped. */
export async function skipIfSchemaMismatch(
  client: Client,
  request: Omit<LockRequest, "schemaVersion">,
  required: number,
): Promise<{ skipped: boolean; state: SchemaState }> {
  const state = await readSchemaState(client);
  if (schemaFits(state, required)) return { skipped: false, state };
  await client.query(
    `INSERT INTO core.job_run (job, country_id, schedule_point, is_retry, status, finished_at, code_version, schema_version, error_codes)
     VALUES ($1, $2, $3, $4, 'skipped', now(), $5, $6, array['schema_version'])`,
    [
      request.job,
      request.countryId,
      request.point,
      request.isRetry,
      request.codeVersion,
      state.schemaVersion,
    ],
  );
  return { skipped: true, state };
}

export async function acquireLock(client: Client, request: LockRequest): Promise<LockResult> {
  const { job, countryId, point } = request;

  // A crashed run keeps its row as running until its lease ends.
  await client.query(
    `UPDATE core.job_run SET status = 'failed', finished_at = now(), error_codes = array['lease_expired']
     WHERE job = $1 AND coalesce(country_id, 0) = coalesce($2::smallint, 0)
       AND status = 'running' AND lease_until < now()`,
    [job, countryId],
  );

  if (request.isRetry && (await pointSucceeded(client, request))) {
    return { acquired: false, reason: "already-succeeded" };
  }

  try {
    const inserted = await client.query<{ id: string; attempt: number }>(
      `INSERT INTO core.job_run
         (job, country_id, schedule_point, attempt, is_retry, status, lease_until, delay_ms, code_version, schema_version)
       SELECT $1, $2, $3,
              (SELECT count(*) + 1 FROM core.job_run
                WHERE job = $1 AND coalesce(country_id, 0) = coalesce($2::smallint, 0) AND schedule_point = $3),
              $4, 'running', now() + make_interval(secs => $5),
              greatest(0, (extract(epoch FROM now() - $3::timestamptz) * 1000)::integer), $6, $7
       RETURNING id, attempt`,
      [job, countryId, point, request.isRetry, LEASE_SECONDS, request.codeVersion, request.schemaVersion],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("job_run insert returned nothing");
    return { acquired: true, runId: Number(row.id), attempt: row.attempt };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (await pointSucceeded(client, request)) return { acquired: false, reason: "already-succeeded" };
    const samePoint = await client.query(
      `SELECT 1 FROM core.job_run
       WHERE job = $1 AND coalesce(country_id, 0) = coalesce($2::smallint, 0) AND schedule_point = $3 AND status = 'running'`,
      [job, countryId, point],
    );
    if (samePoint.rowCount) return { acquired: false, reason: "point-running" };
    // Another schedule point is still running: logged, so the gap is explained (plan 7).
    await client.query(
      `INSERT INTO core.job_run (job, country_id, schedule_point, is_retry, status, finished_at, code_version, schema_version, error_codes)
       VALUES ($1, $2, $3, $4, 'deferred', now(), $5, $6, array['other_run_running'])`,
      [job, countryId, point, request.isRetry, request.codeVersion, request.schemaVersion],
    );
    return { acquired: false, reason: "other-run-running" };
  }
}

export type RunFinish = {
  status: "succeeded" | "failed";
  durationMs: number;
  cpuMs: number;
  requestCount?: number;
  errorCodes?: string[];
  details?: Record<string, unknown>;
};

/**
 * Ends a run, but only while the lease is still this run's own. Returns false
 * if another attempt has taken over, and then nothing is written.
 */
export async function finishRun(client: Client, runId: number, finish: RunFinish): Promise<boolean> {
  const result = await client.query(
    `UPDATE core.job_run
     SET status = $2, finished_at = now(), duration_ms = $3, cpu_ms = $4, request_count = $5,
         error_codes = $6, details = $7
     WHERE id = $1 AND status = 'running' AND lease_until > now()`,
    [
      runId,
      finish.status,
      finish.durationMs,
      finish.cpuMs,
      finish.requestCount ?? 0,
      finish.errorCodes ?? null,
      finish.details ?? null,
    ],
  );
  return result.rowCount === 1;
}

async function pointSucceeded(client: Client, request: LockRequest): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM core.job_run
     WHERE job = $1 AND coalesce(country_id, 0) = coalesce($2::smallint, 0) AND schedule_point = $3 AND status = 'succeeded'`,
    [request.job, request.countryId, request.point],
  );
  return (result.rowCount ?? 0) > 0;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;
}
