import { createHash } from "node:crypto";

import type { Client } from "pg";

import { MEASUREMENT_ALERTS, type AlertDraft, type AlertType, type StoredAlert } from "@/lib/alerts/types";
import { alertEmail } from "@/lib/email/emails";
import { STOCKHOLM, zonedHour } from "@/lib/time";

import type { Fetcher } from "./http";
import { sendToAdmins, type SendResult } from "./mailer";

// The alert outbox (plan 8.1). Alerts are saved as pending in the run's
// transaction; afterwards one e-mail goes out with every pending or failed
// alert, at most 3 a day. Later alerts wait for the daily summary. A failed
// send is retried by the next measurement and by the guard.

export const ALERT_EMAILS_PER_DAY = 3;

export type OutboxAlert = StoredAlert & { measuredAt: Date | null; dedupeKey: string };

/** Alerts that have not gone out, oldest first. */
export async function unsentAlerts(client: Client, types: readonly AlertType[]): Promise<OutboxAlert[]> {
  const rows = await client.query<{
    id: string;
    dedupe_key: string;
    type: AlertType;
    payload: Record<string, unknown>;
    created_at: Date;
    schedule_point: Date | null;
    started_at: Date | null;
  }>(
    `SELECT a.id, a.dedupe_key, a.type, a.payload, a.created_at, r.schedule_point, r.started_at
     FROM core.alert a LEFT JOIN core.job_run r ON r.id = a.job_run_id
     WHERE a.status IN ('pending', 'failed') AND a.type = ANY($1::text[])
     ORDER BY a.id`,
    [types],
  );
  return rows.rows.map((r) => ({
    id: Number(r.id),
    dedupeKey: r.dedupe_key,
    type: r.type,
    payload: r.payload,
    createdAt: r.created_at,
    point: r.schedule_point,
    measuredAt: r.started_at,
  }));
}

/** Marks alerts by the outcome of the e-mail they were in. A skipped send leaves them pending. */
export async function markAlerts(
  client: Client,
  ids: number[],
  result: SendResult,
  sentWith: "alert" | "summary",
  at: Date,
): Promise<void> {
  if (ids.length === 0 || result.status === "skipped") return;
  if (result.status === "sent") {
    await client.query(
      `UPDATE core.alert SET status = 'sent', sent_at = $2, sent_with = $3, attempts = attempts + 1, last_error_code = NULL
       WHERE id = ANY($1::bigint[])`,
      [ids, at, sentWith],
    );
  } else {
    await client.query(
      `UPDATE core.alert SET status = 'failed', attempts = attempts + 1, last_error_code = $2 WHERE id = ANY($1::bigint[])`,
      [ids, result.code],
    );
  }
}

export type OutboxResult =
  { status: "none" } | { status: "capped"; waiting: number } | (SendResult & { alerts: number });

export async function sendPendingAlerts(
  client: Client,
  input: { apiKey: string | undefined; now: Date; timeZone?: string; fetcher?: Fetcher },
): Promise<OutboxResult> {
  const timeZone = input.timeZone ?? STOCKHOLM;
  const alerts = await unsentAlerts(client, MEASUREMENT_ALERTS);
  if (alerts.length === 0) return { status: "none" };

  // One alert e-mail is all alerts sent at the same moment.
  const sentToday = await client.query<{ emails: number }>(
    `SELECT count(DISTINCT sent_at)::int AS emails FROM core.alert WHERE sent_with = 'alert' AND sent_at >= $1`,
    [zonedHour(input.now, 0, timeZone)],
  );
  if ((sentToday.rows[0]?.emails ?? 0) >= ALERT_EMAILS_PER_DAY) {
    return { status: "capped", waiting: alerts.length };
  }

  const ids = alerts.map((a) => a.id);
  const measuredAt = alerts.reduce<Date>(
    (latest, a) => (a.measuredAt && a.measuredAt > latest ? a.measuredAt : latest),
    alerts[0]!.measuredAt ?? alerts[0]!.createdAt,
  );
  const result = await sendToAdmins(client, {
    apiKey: input.apiKey,
    type: "alert",
    // The same alerts always make the same e-mail, so a retry is a no-op at Resend.
    idempotencyKey: `alerts-${createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 40)}`,
    email: alertEmail({ alerts, measuredAt, now: input.now, timeZone }),
    fetcher: input.fetcher,
  });
  await markAlerts(client, ids, result, "alert", input.now);
  return { ...result, alerts: ids.length };
}

/** Saved as pending, so a failed send is picked up later; the key makes an event alert once (plan 8.1). */
export async function saveAlerts(
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
