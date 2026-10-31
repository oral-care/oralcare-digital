import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";

import type { JobOutcome } from "../availability/run";
import { withClient } from "../runtime/db";
import { codeVersion, type JobEnv } from "../runtime/env";
import { acquireLock, finishRun, skipIfSchemaMismatch } from "../runtime/lock";
import { startMeter } from "../runtime/measure";
import { guardDecision } from "../runtime/schedule";

// The daily guard (plan 7). In step 1 it only logs its run with the app's role;
// the checks, the summary and the retention come in step 2.

export const GUARD_JOB = "guard";

export async function runGuard(input: { now: Date; env: JobEnv }): Promise<JobOutcome> {
  const meter = startMeter();
  const decision = guardDecision(input.now);
  if (decision.kind === "none") return { status: "nothing-scheduled" };

  return withClient(input.env.DATABASE_URL_APP, async (client) => {
    const request = {
      job: GUARD_JOB,
      countryId: null,
      point: decision.point,
      isRetry: decision.kind === "retry",
      codeVersion: codeVersion(),
    };
    const schema = await skipIfSchemaMismatch(client, request, REQUIRED_SCHEMA);
    if (schema.skipped) return { status: "skipped", reason: "schema-version" };

    const lock = await acquireLock(client, { ...request, schemaVersion: schema.state.schemaVersion });
    if (!lock.acquired) return { status: "not-run", reason: lock.reason };

    const finished = await finishRun(client, lock.runId, {
      status: "succeeded",
      ...meter(),
      details: { step: 1, note: "No checks yet. Proves cron, lock and run log." },
    });
    return { status: finished ? "succeeded" : "failed", runId: lock.runId };
  });
}
