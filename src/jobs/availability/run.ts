import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";
import { marketByCode, type MarketCode } from "@/lib/markets";

import { withClient } from "../runtime/db";
import { codeVersion, type JobEnv } from "../runtime/env";
import { acquireLock, finishRun, skipIfSchemaMismatch } from "../runtime/lock";
import { startMeter } from "../runtime/measure";
import { availabilityDecision } from "../runtime/schedule";

// One measurement for one market (plan 6.1). In step 1 the run only proves the
// chain end to end: cron call, schedule point, schema version, lock and run
// log. The registry, the sources and the comparison come in step 2.

export const AVAILABILITY_JOB = "availability";

export type JobOutcome =
  | { status: "nothing-scheduled" }
  | { status: "skipped"; reason: "schema-version" }
  | { status: "not-run"; reason: "already-succeeded" | "point-running" | "other-run-running" }
  | { status: "succeeded" | "failed"; runId: number };

export async function runAvailability(input: {
  market: MarketCode;
  now: Date;
  env: JobEnv;
}): Promise<JobOutcome> {
  const meter = startMeter();
  const market = marketByCode(input.market);
  const decision = availabilityDecision(input.now, market.timeZone);
  if (decision.kind === "none") return { status: "nothing-scheduled" };

  return withClient(input.env.DATABASE_URL_COLLECTOR, async (client) => {
    const country = await client.query<{ id: number }>("SELECT id FROM core.country WHERE code = $1", [
      market.code,
    ]);
    const countryId = country.rows[0]?.id;
    if (countryId === undefined) throw new Error(`Market ${market.code} is missing in core.country`);

    const request = {
      job: AVAILABILITY_JOB,
      countryId,
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
      details: { step: 1, note: "No measurement yet. Proves cron, lock and run log." },
    });
    return { status: finished ? "succeeded" : "failed", runId: lock.runId };
  });
}
