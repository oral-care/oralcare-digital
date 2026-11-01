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

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function zonedDay(instant: Date, timeZone: string = STOCKHOLM): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return isoDay(year, month, day);
}

/** The instant a calendar day starts in a time zone. */
export function zonedDayStart(day: string, timeZone: string = STOCKHOLM): Date {
  const { year, month, date } = dayParts(day);
  return new Date(new TZDate(year, month, date, 0, 0, 0, 0, timeZone).getTime());
}

// Calendar days as YYYY-MM-DD, without time or time zone: the pages' periods
// and the chart's days. Counted with UTC dates, which have no daylight saving.

const DAY_MS = 86_400_000;

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Year, month (0-11) and day of the month of a calendar day. */
export function dayParts(day: string): { year: number; month: number; date: number } {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return { year, month: month - 1, date };
}

const utc = (day: string) => {
  const { year, month, date } = dayParts(day);
  return Date.UTC(year, month, date);
};

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether the text is a real calendar day, such as 2026-10-31. */
export function isDay(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && fromUtc(utc(text)) === text;
}

export function addDays(day: string, days: number): string {
  return fromUtc(utc(day) + days * DAY_MS);
}

/** Days from a to b: 0 for the same day, 1 when b is the day after a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/** Every day from the first to the last, both included. */
export function daySpan(first: string, last: string): string[] {
  const count = daysBetween(first, last) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(first, i));
}

/** The first day of the day's month, moved by a number of months. */
export function monthStart(day: string, months = 0): string {
  const { year, month } = dayParts(day);
  return fromUtc(Date.UTC(year, month + months, 1));
}

/** The day's weekday, 0 for Monday to 6 for Sunday. */
export function weekday(day: string): number {
  return (new Date(utc(day)).getUTCDay() + 6) % 7;
}

// Written out rather than with Intl, whose English short months differ
// between versions ("Sep" or "Sept"); the pages always say "29 Sep" (plan 4.12).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Sat 31 Oct */
export function dayLabel(day: string): string {
  return `${WEEKDAYS[weekday(day)]} ${shortDate(day)}`;
}

/** 29 Sep */
export function shortDate(day: string): string {
  const { month, date } = dayParts(day);
  return `${date} ${MONTHS[month]}`;
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

/** October 2026 */
export const monthLabel = (day: string): string => monthFormat.format(utc(day));
