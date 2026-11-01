import { STOCKHOLM, zonedHour } from "@/lib/time";

// Whether the data is up to date (plan 8.3): it isn't when neither of the two
// latest schedule points that have passed has a successful measurement. Before
// 08, yesterday's 22 counts as the one before 06, so the night alone never
// makes the data look old. On Hobby the 14 measurement can start at 14:59, and
// then it is enough that 12 succeeded. Used by the banner and the second
// guard (watch.yml). Pure module.

const DAY_MS = 24 * 60 * 60_000;
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/** The two latest even Swedish hours 06-22 at or before now, newest first. */
export function lastTwoPoints(now: Date, timeZone: string = STOCKHOLM): [Date, Date] {
  const candidates: Date[] = [];
  for (const day of [now, new Date(now.getTime() - DAY_MS)]) {
    for (let hour = LAST_HOUR; hour >= FIRST_HOUR; hour -= 2) {
      const point = zonedHour(day, hour, timeZone);
      if (point.getTime() <= now.getTime()) candidates.push(point);
    }
  }
  const [latest, before] = candidates.sort((a, b) => b.getTime() - a.getTime());
  return [latest!, before!];
}

export function isStale(now: Date, succeededPoints: Date[], timeZone: string = STOCKHOLM): boolean {
  const done = new Set(succeededPoints.map((d) => d.getTime()));
  return !lastTwoPoints(now, timeZone).some((point) => done.has(point.getTime()));
}
