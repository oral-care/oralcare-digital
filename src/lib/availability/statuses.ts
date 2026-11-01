// Availability and waiting time per clinic and treatment (plan 5.2), with the
// thresholds that applied that day. A null status means the treatment is not
// online.

export type Thresholds = { goodMinSlots: number; shortMaxDays: number };
export type Availability = "good" | "low";
export type WaitingTime = "short" | "long";

export function availabilityStatus(slots14: number, thresholds: Thresholds): Availability | null {
  if (slots14 <= 0) return null;
  return slots14 >= thresholds.goodMinSlots ? "good" : "low";
}

export function waitingTimeStatus(firstFreeDays: number | null, thresholds: Thresholds): WaitingTime | null {
  if (firstFreeDays === null) return null;
  return firstFreeDays <= thresholds.shortMaxDays ? "short" : "long";
}

export type ClinicStatus<S extends string> = S | "mixed" | "notOnline";

/**
 * A clinic's status from its treatments' (plan 5.2): the same for every
 * treatment that is online gives that status, different ones give Mixed, and
 * none online gives Not online. Null means the treatment is not online.
 */
export function clinicStatus<S extends string>(statuses: (S | null)[]): ClinicStatus<S> {
  const online = new Set(statuses.filter((s): s is S => s !== null));
  if (online.size === 0) return "notOnline";
  return online.size === 1 ? [...online][0]! : "mixed";
}
