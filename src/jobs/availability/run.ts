import { estimateLeadMinutes, measurementWindow, WINDOW_DAYS } from "@/lib/availability/window";
import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";
import { marketByCode, type MarketCode } from "@/lib/markets";
import { zonedDay, zonedHour, zonedParts } from "@/lib/time";

import { saveAlerts, sendPendingAlerts } from "../runtime/alert-mail";
import { withClient } from "../runtime/db";
import { codeVersion, type JobEnv } from "../runtime/env";
import { realClock, RunGuard, SourceClient, type Clock, type Fetcher } from "../runtime/http";
import { acquireLock, finishRun, skipIfSchemaMismatch } from "../runtime/lock";
import { startMeter } from "../runtime/measure";
import { availabilityDecision } from "../runtime/schedule";
import { collect, failure, type Sources } from "./collect";
import { loadContext, type Context } from "./context";
import { dailyRows, evaluate, type FormatProblem } from "./evaluate";
import { planPairs, removedTreatments, webClinics } from "./pairs";
import { persist } from "./persist";
import { diffRegistry } from "./registry";
import { Muntra } from "./sources/epr/muntra";
import type { Registry } from "./sources/types";
import { OralcareSe } from "./sources/web/oralcare-se";

// One measurement for one market (plan 6.1): lock, registry, both sources,
// comparison, and everything saved in one transaction with the run marked as
// succeeded. Alerts are saved as pending and sent afterwards (plan 8.1).

export const AVAILABILITY_JOB = "availability";

/** Limits per source (plan 6.6). The budget is per day, so a run gets what is left of it. */
const WEB_LIMITS = {
  name: "oralcare_se",
  concurrency: 3,
  minIntervalMs: 500,
  timeoutMs: 15_000,
  dailyBudget: 1_300,
};
const EPR_LIMITS = {
  name: "muntra",
  concurrency: 4,
  minIntervalMs: 500,
  timeoutMs: 10_000,
  dailyBudget: 1_500,
};
/** From the call's start (plan 7): no activation list after 240 s, no new request after 270 s. */
const ACTIVATION_UNTIL_MS = 240_000;
const DEADLINE_MS = 270_000;
/** The activation list is read at the 08 point, or later in the day if that read failed. */
const ACTIVATION_POINT_HOUR = 8;
const ACTIVATION_MAX_AGE_MS = 23 * 60 * 60_000;
/** The daily value: the 08 point, or the 10 point when 08 and its retry wrote nothing (plan 5.5). */
const DAILY_POINT_HOUR = 8;
const DAILY_FALLBACK_HOUR = 10;

export type JobOutcome =
  | { status: "nothing-scheduled" }
  | { status: "skipped"; reason: "schema-version" }
  | { status: "not-run"; reason: "already-succeeded" | "point-running" | "other-run-running" }
  | { status: "succeeded" | "failed"; runId: number };

/** Tests and local runs pass their own sources, fetch, clock and e-mail fetch. */
export type RunDeps = { sources?: Sources; fetcher?: Fetcher; clock?: Clock; mailFetcher?: Fetcher };

type RunInput = { market: MarketCode; now: Date; env: JobEnv; deps?: RunDeps };

export async function runAvailability(input: RunInput): Promise<JobOutcome> {
  const outcome = await measureAndLog(input);
  // Step 9 (plan 6.1): pending alerts go out after the run's transaction, also
  // after a failed or skipped run, which can raise alerts of its own.
  if (outcome.status === "succeeded" || outcome.status === "failed" || outcome.status === "skipped") {
    await sendAlerts(input);
  }
  return outcome;
}

async function sendAlerts(input: RunInput): Promise<void> {
  try {
    await withClient(input.env.DATABASE_URL_COLLECTOR, (client) =>
      sendPendingAlerts(client, {
        apiKey: input.env.RESEND_API_KEY,
        now: input.now,
        timeZone: marketByCode(input.market).timeZone,
        fetcher: input.deps?.mailFetcher,
      }),
    );
  } catch (error) {
    // The measurement is saved; the alerts stay pending for the next run and the guard.
    console.error("availability: sending alerts failed", error);
  }
}

async function measureAndLog(input: RunInput): Promise<JobOutcome> {
  const meter = startMeter();
  const clock = input.deps?.clock ?? realClock;
  const market = marketByCode(input.market);
  const decision = availabilityDecision(input.now, market.timeZone);
  if (decision.kind === "none") return { status: "nothing-scheduled" };
  const url = input.env.DATABASE_URL_COLLECTOR;
  const day = zonedDay(decision.point, market.timeZone);

  const lock = await withClient(url, async (client) => {
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
    if (schema.skipped) {
      await saveAlerts(client, countryId, null, market.code, day, [
        {
          type: "schema_version",
          subject: "-",
          payload: { point: decision.point, database: schema.state.schemaVersion, code: REQUIRED_SCHEMA },
        },
      ]);
      return { acquired: false as const, outcome: { status: "skipped", reason: "schema-version" } as const };
    }
    const result = await acquireLock(client, { ...request, schemaVersion: schema.state.schemaVersion });
    if (!result.acquired)
      return { acquired: false as const, outcome: { status: "not-run", reason: result.reason } as const };
    return { acquired: true as const, runId: result.runId, countryId };
  });
  if (!lock.acquired) return lock.outcome;
  const { runId, countryId } = lock;

  try {
    const ok = await measure({
      ...input,
      clock,
      market,
      point: decision.point,
      isRetry: decision.kind === "retry",
      day,
      runId,
      meter,
    });
    return { status: ok ? "succeeded" : "failed", runId };
  } catch (error) {
    const { reason } = failure(error);
    const code = reason === "error" && error instanceof Error ? `error:${error.name}` : reason;
    console.error(`availability ${market.code} run ${runId} failed`, error);
    await withClient(url, async (client) => {
      await finishRun(client, runId, { status: "failed", ...meter(), errorCodes: [code] });
      // A retry that fails leaves the point without a measurement (plan 8.1).
      if (decision.kind === "retry") {
        await saveAlerts(client, countryId, runId, market.code, day, [
          {
            type: "measurement_failed",
            subject: decision.point.toISOString(),
            payload: { point: decision.point, retryAt: input.now, error: code },
          },
        ]);
      }
    });
    return { status: "failed", runId };
  }
}

async function measure(run: {
  env: JobEnv;
  deps?: RunDeps;
  clock: Clock;
  market: ReturnType<typeof marketByCode>;
  point: Date;
  isRetry: boolean;
  day: string;
  runId: number;
  meter: ReturnType<typeof startMeter>;
}): Promise<boolean> {
  const { clock, market, point } = run;
  const url = run.env.DATABASE_URL_COLLECTOR;
  const startedAt = clock.now();
  const measuredAt = new Date(startedAt);
  const timeZone = market.timeZone;

  const ctx = await withClient(url, (client) =>
    loadContext(client, {
      countryCode: market.code,
      point,
      now: measuredAt,
      dayStart: zonedHour(point, 0, timeZone),
      day: run.day,
    }),
  );

  const guard = new RunGuard(startedAt + DEADLINE_MS, clock);
  const client = (limits: typeof WEB_LIMITS, used: number) =>
    new SourceClient({ ...limits, budget: Math.max(0, limits.dailyBudget - used) }, guard, run.deps?.fetcher);
  const webClient = client(WEB_LIMITS, ctx.requestsToday.web);
  const eprClient = client(EPR_LIMITS, ctx.requestsToday.epr);
  const sources = run.deps?.sources ?? { web: new OralcareSe(webClient), epr: new Muntra(eprClient) };

  // Step 2: the registry. If a page fails, the stored registry is measured and nothing in it changes.
  let registry: Registry | null = null;
  let registryError: string | null = null;
  const registryProblems: FormatProblem[] = [];
  try {
    registry = await sources.web.readRegistry();
  } catch (error) {
    const { reason, format } = failure(error);
    registryError = reason;
    if (format) registryProblems.push(format);
  }

  const maxLeadDays = registry?.maxLeadDays ?? ctx.previousRun?.maxLeadDays ?? WINDOW_DAYS;
  const leadMinutes = estimateLeadMinutes(ctx.shortestLeadMinutes);
  const window = measurementWindow(measuredAt, leadMinutes, maxLeadDays);
  const pairs = planPairs(ctx, registry);
  if (pairs.length === 0) throw new Error(`No clinics to measure (registry: ${registryError ?? "empty"})`);

  const collected = await collect({
    pairs,
    sources,
    window,
    measuredAt,
    timeZone,
    clock,
    activationClinics: activationDue(ctx, point, measuredAt, timeZone)
      ? activationClinics(ctx, registry)
      : [],
    activationUntil: startedAt + ACTIVATION_UNTIL_MS,
    removed: removedTreatments(ctx, registry),
  });

  const previousMaxLead = ctx.previousRun?.maxLeadDays ?? null;
  const evaluation = evaluate({
    ctx,
    pairs: collected.pairs,
    results: collected.results,
    activation: collected.activation,
    window,
    measuredAt,
    timeZone,
    stopped: collected.stopped,
    withdrawn: collected.withdrawn.map((webKey) => ({
      webKey,
      name: ctx.treatments.get(webKey)?.name ?? webKey,
    })),
    otherFormatProblems: [...registryProblems, ...collected.formatProblems],
    maxLeadChange:
      registry && previousMaxLead !== null && previousMaxLead !== registry.maxLeadDays
        ? { before: previousMaxLead, after: registry.maxLeadDays }
        : null,
  });
  const writes = diffRegistry({
    ctx,
    registry,
    activation: collected.activation,
    procedureIds: new Map(collected.pairs.map((p) => [p.key, new Set(p.procedureIds)])),
    eprSlots: evaluation.eprSlots14,
  });

  const pointHour = zonedParts(point, timeZone).hour;
  const writeDaily =
    pointHour === DAILY_POINT_HOUR || (pointHour === DAILY_FALLBACK_HOUR && !ctx.dailyValueExists);
  const errorCodes = [
    ...webClient.errorCodes,
    ...eprClient.errorCodes,
    ...(registryError ? [`registry:${registryError}`] : []),
  ].sort();

  return withClient(url, (db) =>
    persist(db, {
      ctx,
      runId: run.runId,
      marketCode: market.code,
      day: run.day,
      windowStart: window.from,
      writes,
      evaluation,
      daily: writeDaily
        ? {
            rows: dailyRows(ctx, evaluation.measurements),
            isLate: run.isRetry || pointHour !== DAILY_POINT_HOUR,
          }
        : null,
      codeVersion: codeVersion(),
      finish: {
        ...run.meter(),
        requestCount: webClient.requests + eprClient.requests,
        errorCodes: errorCodes.length > 0 ? errorCodes : undefined,
        // Counts and codes only, never source data (plan 12).
        details: {
          requests: { web: webClient.requests, epr: eprClient.requests },
          maxLeadDays,
          leadMinutes,
          windowEnd: window.to,
          registry: registry ? "read" : registryError,
          activationFetched: collected.activationComplete,
          pairs: collected.pairs.length,
          remeasured: collected.remeasured,
          coverage: evaluation.coverage,
          incident: evaluation.incident !== null,
          stopped: collected.stopped,
          changes: writes.events.length,
          alerts: evaluation.alerts.length,
          dailyValue: writeDaily,
        },
      },
    }),
  );
}

function activationDue(ctx: Context, point: Date, measuredAt: Date, timeZone: string): boolean {
  if (zonedParts(point, timeZone).hour === ACTIVATION_POINT_HOUR) return true;
  const last = ctx.activationFetchedAt;
  return last === null || measuredAt.getTime() - last.getTime() > ACTIVATION_MAX_AGE_MS;
}

/** Every clinic, also those no longer on the web, which are still measured in the booking system (plan 6.5). */
function activationClinics(ctx: Context, registry: Registry | null): string[] {
  const clinics = new Set(ctx.clinics.keys());
  if (registry) for (const eprId of webClinics(registry).keys()) clinics.add(eprId);
  return [...clinics].sort();
}
