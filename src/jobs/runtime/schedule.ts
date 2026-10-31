import { STOCKHOLM, zonedHour, zonedParts } from "@/lib/time";

// Which schedule point a cron call is for (plan 7). The point is the even
// Swedish hour 06-22 a measurement is for. A call in an even hour measures
// that hour; a call in an odd hour 07-23 retries the hour before. This works
// on Hobby, which starts a job any time within its hour, and on Pro.

export type ScheduleDecision =
  { kind: "measure"; point: Date } | { kind: "retry"; point: Date } | { kind: "none" };

export const FIRST_POINT_HOUR = 6;
export const LAST_POINT_HOUR = 22;

export function availabilityDecision(now: Date, timeZone: string = STOCKHOLM): ScheduleDecision {
  const { hour } = zonedParts(now, timeZone);
  if (hour % 2 === 0 && hour >= FIRST_POINT_HOUR && hour <= LAST_POINT_HOUR) {
    return { kind: "measure", point: zonedHour(now, hour, timeZone) };
  }
  if (hour % 2 === 1 && hour >= FIRST_POINT_HOUR + 1 && hour <= LAST_POINT_HOUR + 1) {
    return { kind: "retry", point: zonedHour(now, hour - 1, timeZone) };
  }
  return { kind: "none" };
}

// The guard runs at 09 UTC with a retry at 10 UTC. Both calls share the day's
// 09:00 UTC point, so the lock lets only one of them run.
export function guardDecision(now: Date): ScheduleDecision {
  const hour = now.getUTCHours();
  const point = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9));
  if (hour === 9) return { kind: "measure", point };
  if (hour === 10) return { kind: "retry", point };
  return { kind: "none" };
}
