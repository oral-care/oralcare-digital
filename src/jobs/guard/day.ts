import { STOCKHOLM, zonedDay, zonedHour, zonedParts } from "@/lib/time";

// The day the guard looks back on: yesterday in Swedish time (plan 8.2), with
// the schedule points 06-22 that should each have a successful measurement.

export type GuardDay = {
  /** YYYY-MM-DD in Swedish time. */
  day: string;
  start: Date;
  end: Date;
  /** The even hours 06-22 of that day. */
  points: Date[];
  /** The day in UTC, which Resend and the e-mail quota count by. */
  utcDay: string;
  isSunday: boolean;
};

const DAY_MS = 24 * 60 * 60_000;

export function yesterday(now: Date, timeZone: string = STOCKHOLM): GuardDay {
  const end = zonedHour(now, 0, timeZone);
  const noon = zonedHour(new Date(end.getTime() - DAY_MS / 2), 12, timeZone);
  const start = zonedHour(noon, 0, timeZone);
  const points = Array.from({ length: 9 }, (_, i) => zonedHour(noon, 6 + 2 * i, timeZone));
  // 1970-01-04 was a Sunday, so whole days since then modulo 7 give the weekday.
  const { year, month, day } = zonedParts(noon, timeZone);
  const weekday = Math.round(Date.UTC(year, month, day) / DAY_MS - 3) % 7;
  return {
    day: zonedDay(noon, timeZone),
    start,
    end,
    points,
    utcDay: new Date(end.getTime() - 1).toISOString().slice(0, 10),
    isSunday: weekday === 0,
  };
}
