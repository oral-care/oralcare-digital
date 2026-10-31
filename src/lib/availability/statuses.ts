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
