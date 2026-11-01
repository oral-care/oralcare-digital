// The alerts every module can raise (plan 8.1 and 8.2), in the order the
// e-mails list them: the most serious first. Pure module.

/** Raised by a measurement, sent in the alert e-mails. */
export const MEASUREMENT_ALERTS = [
  "measurement_failed",
  "schema_version",
  "incident",
  "low_coverage",
  "stopped_early",
  "treatment_not_online",
  "treatment_withdrawn",
  "slots_not_online",
  "max_lead_changed",
  "window_anomaly",
  "format",
  "collector_error",
] as const;

/** Raised by the guard, shown under "Needs attention" in the daily summary only. */
export const GUARD_ALERTS = [
  "missing_measurements",
  "backup_old",
  "limit",
  "vercel_token",
  "sign_in_limit",
  "admin_inactive",
  "rights",
] as const;

export type MeasurementAlertType = (typeof MEASUREMENT_ALERTS)[number];
export type GuardAlertType = (typeof GUARD_ALERTS)[number];
export type AlertType = MeasurementAlertType | GuardAlertType;

/** An alert to save. The subject makes the dedupe key with type, market and day: one alert per event and day. */
export type AlertDraft = { type: AlertType; subject: string; payload: Record<string, unknown> };

/** An alert as saved in core.alert. The payload holds facts for the lines, never personal data. */
export type StoredAlert = {
  id: number;
  type: AlertType;
  payload: Record<string, unknown>;
  createdAt: Date;
  /** The schedule point of the run that raised it, if a run did. */
  point: Date | null;
};

export function isGuardAlert(type: AlertType): type is GuardAlertType {
  return (GUARD_ALERTS as readonly string[]).includes(type);
}

/** The guard's alerts first, then the measurement's, each in its table's order. */
const ORDER: readonly AlertType[] = [...GUARD_ALERTS, ...MEASUREMENT_ALERTS];

export function byOrder(a: StoredAlert, b: StoredAlert): number {
  return ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.id - b.id;
}
