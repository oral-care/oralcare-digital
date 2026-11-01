import type { Client } from "pg";

import { alertLine } from "@/lib/alerts/lines";
import { byOrder, GUARD_ALERTS, MEASUREMENT_ALERTS } from "@/lib/alerts/types";
import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";
import { summaryEmail } from "@/lib/email/emails";
import { measuredMarkets } from "@/lib/markets";
import { STOCKHOLM } from "@/lib/time";

import type { JobOutcome } from "../availability/run";
import { markAlerts, saveAlerts, sendPendingAlerts, unsentAlerts } from "../runtime/alert-mail";
import { withClient } from "../runtime/db";
import { codeVersion, type JobEnv } from "../runtime/env";
import type { Fetcher } from "../runtime/http";
import { acquireLock, finishRun, skipIfSchemaMismatch } from "../runtime/lock";
import { sendToAdmins } from "../runtime/mailer";
import { startMeter } from "../runtime/measure";
import { guardDecision } from "../runtime/schedule";
import { guardChecks, lastBackup, usage } from "./checks";
import { yesterday } from "./day";
import { pruneAuth } from "./prune";
import { summaryData } from "./summary";

// The daily guard (plan 7 and 8.2), with the app's role: checks yesterday,
// sends alerts that haven't gone out, sends the daily summary and prunes old
// rows in core and auth (plan 10.4). If the summary couldn't be sent, the run
// is logged as failed, so the call at 10 UTC tries again; Resend's
// Idempotency-Key keeps that from sending it twice.

export const GUARD_JOB = "guard";

export async function runGuard(input: {
  now: Date;
  env: JobEnv;
  deps?: { mailFetcher?: Fetcher };
}): Promise<JobOutcome> {
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

    try {
      const now = input.now;
      const day = yesterday(now, STOCKHOLM);
      const fetcher = input.deps?.mailFetcher;
      const apiKey = input.env.RESEND_API_KEY;

      const countries = await client.query<{ id: number; code: string }>("SELECT id, code FROM core.country");
      const markets = [];
      for (const market of measuredMarkets()) {
        const countryId = countries.rows.find((c) => c.code === market.code)?.id;
        if (countryId === undefined) continue;
        const runs = await client.query<{ schedule_point: Date }>(
          `SELECT schedule_point FROM core.job_run
           WHERE job = 'availability' AND country_id = $1 AND status = 'succeeded'
             AND schedule_point >= $2 AND schedule_point < $3`,
          [countryId, day.start, day.end],
        );
        markets.push({
          code: market.code,
          countryId,
          market,
          succeeded: runs.rows.map((r) => r.schedule_point),
        });
      }

      const used = await usage(client, now);
      const backup = await lastBackup(client);
      const findings = await guardChecks(client, { now, day, markets, usage: used, lastBackup: backup });
      for (const finding of findings) {
        await saveAlerts(client, finding.countryId, lock.runId, finding.market, day.day, [finding.alert]);
      }

      // Measurement alerts that didn't go out, within the day's cap of alert e-mails.
      const outbox = await sendPendingAlerts(client, { apiKey, now, timeZone: STOCKHOLM, fetcher });

      // "Needs attention": today's findings and measurement alerts still waiting (plan 8.2).
      // Older findings that never went out are replaced by today's checks.
      const guardAlerts = await unsentAlerts(client, GUARD_ALERTS);
      const current = guardAlerts.filter((a) => a.dedupeKey.endsWith(`:${day.day}`));
      const replaced = guardAlerts.filter((a) => !current.includes(a));
      const attention = [...current, ...(await unsentAlerts(client, MEASUREMENT_ALERTS))].sort(byOrder);
      const names = await adminNames(
        client,
        attention.filter((a) => a.type === "admin_inactive").map((a) => String(a.payload.userId)),
      );
      const lines = attention.map((a) =>
        alertLine(
          a.type === "admin_inactive"
            ? { ...a, payload: { name: names.get(String(a.payload.userId)) ?? "" } }
            : a,
          STOCKHOLM,
        ),
      );

      const data = await summaryData(client, { now, day, markets, usage: used, lastBackup: backup });
      const summary = await sendToAdmins(client, {
        apiKey,
        type: "summary",
        idempotencyKey: `summary-${day.day}`,
        email: summaryEmail({ ...data, attention: lines, timeZone: STOCKHOLM }),
        fetcher,
      });
      await markAlerts(
        client,
        attention.map((a) => a.id),
        summary,
        "summary",
        now,
      );
      if (summary.status === "sent") {
        await markAlerts(
          client,
          replaced.map((a) => a.id),
          summary,
          "summary",
          now,
        );
      }

      const pruned = await client.query<{ removed: Record<string, number> }>(
        "SELECT core.prune() AS removed",
      );
      const prunedAuth = await pruneAuth(client, now);

      const errorCodes = [
        ...(summary.status === "skipped" ? [`summary:${summary.reason}`] : []),
        ...(summary.status === "failed" ? [`summary:${summary.code}`] : []),
        ...("code" in outbox ? [`alerts:${outbox.code}`] : []),
      ];
      const finished = await finishRun(client, lock.runId, {
        status: summary.status === "failed" ? "failed" : "succeeded",
        ...meter(),
        errorCodes: errorCodes.length > 0 ? errorCodes : undefined,
        // Counts and codes only (plan 12).
        details: {
          day: day.day,
          findings: findings.length,
          alerts: outbox.status,
          summary: summary.status,
          attention: attention.length,
          pruned: { core: pruned.rows[0]?.removed ?? {}, auth: prunedAuth },
        },
      });
      return { status: finished && summary.status !== "failed" ? "succeeded" : "failed", runId: lock.runId };
    } catch (error) {
      console.error(`guard run ${lock.runId} failed`, error);
      const code = error instanceof Error ? `error:${error.name}` : "error";
      await finishRun(client, lock.runId, { status: "failed", ...meter(), errorCodes: [code] });
      return { status: "failed", runId: lock.runId };
    }
  });
}

/** Names for the summary only. Alerts keep the user's id, never the name (plan 8.1). */
async function adminNames(client: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await client.query<{ id: string; name: string }>(
    "SELECT id, first_name || ' ' || last_name AS name FROM auth.users WHERE id = ANY($1::text[])",
    [ids],
  );
  return new Map(rows.rows.map((r) => [r.id, r.name]));
}
