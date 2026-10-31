// The measurement window (plan 6.3). oralcare.se starts its own search at
// now + L + 5 minutes rounded up to 5 minutes, where L is its minimum lead time
// for a booking. L is not published, so it is estimated from what oralcare.se
// answers: the web source is always asked from "now" and clamps itself, and the
// shortest distance to a first slot over 7 days bounds L from above.

const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;
const DAY = 24 * 60 * MINUTE;

/** oralcare.se's own default for L (src/lib/booking/slot-window.ts there). */
export const DEFAULT_LEAD_MINUTES = 20;
/** An estimate above this would hide same-day slots, so it is capped. */
export const MAX_LEAD_MINUTES = 180;
export const WINDOW_DAYS = 30;

export function roundUpToFiveMinutes(ms: number): number {
  return Math.ceil(ms / FIVE_MINUTES) * FIVE_MINUTES;
}

/**
 * L from the shortest observed distance between a request and the first slot
 * oralcare.se returned. The first slot is never earlier than L + 5 minutes after
 * the request, so the distance minus 5 is never below L.
 */
export function estimateLeadMinutes(shortestDistanceMinutes: number | null): number {
  if (shortestDistanceMinutes === null) return DEFAULT_LEAD_MINUTES;
  const estimate = Math.floor(shortestDistanceMinutes) - 5;
  return Math.min(MAX_LEAD_MINUTES, Math.max(DEFAULT_LEAD_MINUTES, estimate));
}

export type MeasurementWindow = { from: Date; to: Date };

/**
 * Both sources are compared over the same window: from is the call time plus
 * L plus 5 minutes, rounded up to 5 minutes, plus 5 minutes of margin, so it is
 * never before oralcare.se's own start. To is 30 days later, at most maxLeadDays.
 */
export function measurementWindow(now: Date, leadMinutes: number, maxLeadDays: number): MeasurementWindow {
  const from = roundUpToFiveMinutes(now.getTime() + (leadMinutes + 5) * MINUTE) + FIVE_MINUTES;
  const to = Math.min(from + WINDOW_DAYS * DAY, now.getTime() + maxLeadDays * DAY);
  return { from: new Date(from), to: new Date(Math.max(from, to)) };
}

/** Muntra refuses 31 days or more, so longer windows are split into 30-day parts. */
export function splitForMuntra(window: MeasurementWindow): MeasurementWindow[] {
  const parts: MeasurementWindow[] = [];
  for (let start = window.from.getTime(); start < window.to.getTime(); start += WINDOW_DAYS * DAY) {
    parts.push({
      from: new Date(start),
      to: new Date(Math.min(start + WINDOW_DAYS * DAY, window.to.getTime())),
    });
  }
  return parts.length > 0 ? parts : [window];
}
