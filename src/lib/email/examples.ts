import { alertLine } from "@/lib/alerts/lines";
import { GUARD_ALERTS, MEASUREMENT_ALERTS, type AlertType, type StoredAlert } from "@/lib/alerts/types";

import { alertEmail, invitationEmail, signInCodeEmail, summaryEmail } from "./emails";
import type { Email } from "./layout";

// Made-up data for every e-mail, every alert type and every "Needs attention"
// row (plan 9). Used by pnpm email:preview and the snapshot tests. No real
// people, addresses or clinics' data.

const at = (iso: string) => new Date(iso);
const point = at("2026-10-31T07:00:00Z");

const PAYLOADS: Record<AlertType, Record<string, unknown>[]> = {
  measurement_failed: [{ point: "2026-10-31T09:00:00Z", retryAt: "2026-10-31T10:12:00Z", error: "http_503" }],
  schema_version: [{ point: "2026-10-31T09:00:00Z", database: 2, code: 3 }],
  incident: [{ percent: 42 }],
  low_coverage: [{ percent: 88, measured: 143, expected: 162 }],
  stopped_early: [{ reason: "budget" }, { reason: "failures" }],
  treatment_not_online: [{ clinic: "Example Clinic Norr", treatment: "Akut undersökning", slots: 81 }],
  treatment_withdrawn: [{ treatment: "Konsultation aligner" }],
  slots_not_online: [{ clinic: "Example Clinic Söder", treatment: "Tandhygienistbehandling", slots: 12 }],
  max_lead_changed: [{ before: 90, after: 60 }],
  window_anomaly: [{ clinics: 4 }],
  format: [
    {
      source: "Muntra",
      path: "data.0.relationships.caregiver",
      expected: "object",
      received: "undefined",
      count: 3,
    },
  ],
  collector_error: [
    { variant: "rejected", clinic: "Example Clinic Väst", treatment: "Tandblekning" },
    { variant: "slot_before_window", clinic: "Example Clinic Öst", treatment: "Basundersökning" },
  ],
  missing_measurements: [{ points: ["2026-10-31T11:00:00Z", "2026-10-31T13:00:00Z"] }],
  backup_old: [
    { hours: 31, lastFinishedAt: "2026-10-30T02:41:00Z" },
    { hours: 0, lastFinishedAt: null },
  ],
  limit: [{ service: "Neon database", percent: 62, used: "620 MB", limit: "1 GB" }],
  vercel_token: [{ date: "2027-11-01" }],
  sign_in_limit: [{ at: "2026-10-31T14:20:00Z" }],
  admin_inactive: [{ name: "Alex Example" }],
  rights: [{ role: "oc_collector", difference: "may delete from core.clinic" }],
};

let nextId = 1;
const alert = (type: AlertType, payload: Record<string, unknown>): StoredAlert => ({
  id: nextId++,
  type,
  payload,
  createdAt: point,
  point,
});

export const exampleAlerts = (types: readonly AlertType[]) =>
  types.flatMap((type) => PAYLOADS[type].map((payload) => alert(type, payload)));

export function exampleEmails(): Record<string, Email> {
  const now = at("2026-10-31T07:10:00Z");
  return {
    "1-sign-in-code": signInCodeEmail({ code: "48217390" }),
    "2-invitation": invitationEmail({
      adminName: "Alex Example",
      firstName: "Sam",
      markets: ["Sweden"],
      role: "viewer",
      email: "sam@example.com",
    }),
    "3-alert-one": alertEmail({
      alerts: exampleAlerts(["treatment_not_online"]),
      measuredAt: at("2026-10-31T07:04:00Z"),
      now,
    }),
    "3-alert-three": alertEmail({
      alerts: exampleAlerts(["treatment_not_online", "slots_not_online", "max_lead_changed"]),
      measuredAt: at("2026-10-31T07:04:00Z"),
      now,
    }),
    "3-alert-every-type": alertEmail({
      alerts: exampleAlerts(MEASUREMENT_ALERTS),
      measuredAt: at("2026-10-30T21:04:00Z"),
      now,
    }),
    "4-summary": summaryEmail({
      day: at("2026-10-31T12:00:00Z"),
      measurements: { ran: 9, expected: 9 },
      coverage: 99.4,
      backupDone: true,
      attention: exampleAlerts(["vercel_token"]).map((a) => alertLine(a)),
      markets: [
        {
          name: "Sweden",
          availability: { good: 6, mixed: 11, low: 8, notOnline: 5 },
          waitingTime: { short: 5, mixed: 14, long: 6, notOnline: 5 },
          slotsNotOnline: 5,
        },
      ],
      changes: [],
      serverErrors: 0,
      usage: {
        jobs: { ran: 11, expected: 11 },
        neonDatabasePercent: 31,
        neonTrafficPercent: 18,
        resendSent: 4,
        vercelCpuPercent: 8,
      },
    }),
    "4-summary-every-row": summaryEmail({
      day: at("2026-10-31T12:00:00Z"),
      measurements: { ran: 7, expected: 9 },
      coverage: 91.2,
      backupDone: false,
      attention: [...exampleAlerts(GUARD_ALERTS), ...exampleAlerts(["slots_not_online"])].map((a) =>
        alertLine(a),
      ),
      markets: [
        {
          name: "Sweden",
          availability: { good: 6, mixed: 11, low: 8, notOnline: 5 },
          waitingTime: { short: 5, mixed: 14, long: 6, notOnline: 5 },
          slotsNotOnline: 0,
        },
      ],
      changes: Array.from(
        { length: 12 },
        (_, i) => `Example Clinic ${i + 1} can now be booked for Tandblekning`,
      ),
      serverErrors: 3,
      usage: {
        jobs: { ran: 10, expected: 11 },
        neonDatabasePercent: 62,
        neonTrafficPercent: null,
        resendSent: 27,
        vercelCpuPercent: null,
      },
    }),
  };
}
