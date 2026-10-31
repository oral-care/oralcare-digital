import { TZDate } from "@date-fns/tz";

// All day and hour arithmetic goes through here, in the market's time zone,
// never in the computer's own (plan 13.3). Vercel runs in UTC and browsers run
// wherever the user is.

export const STOCKHOLM = "Europe/Stockholm";

/** The wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string = STOCKHOLM) {
  const zoned = new TZDate(instant.getTime(), timeZone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth(),
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
  };
}

/** The instant of a whole hour on the same wall-clock day. */
export function zonedHour(instant: Date, hour: number, timeZone: string = STOCKHOLM): Date {
  const { year, month, day } = zonedParts(instant, timeZone);
  return new Date(new TZDate(year, month, day, hour, 0, 0, 0, timeZone).getTime());
}
