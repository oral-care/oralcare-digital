import { STOCKHOLM, zonedParts } from "@/lib/time";

import type { MeasurementWindow } from "./window";

// Counting and matching slots (plan 5.3, 5.4 and 6.3). A slot is the same in
// both sources when clinic, booking-system procedure, caregiver and start time
// match. Caregiver ids are used here only and never stored.

export type Slot = { start: Date; caregiverId: string; procedureId: string };

export type SlotSummary = {
  slots7: number;
  slots14: number;
  slots30: number;
  firstFreeAt: Date | null;
  firstFreeDays: number | null;
};

/** Calendar days from the measurement to the slot, in the market's time zone. Today is day 0. */
export function dayIndex(measuredAt: Date, slot: Date, timeZone: string = STOCKHOLM): number {
  const a = zonedParts(measuredAt, timeZone);
  const b = zonedParts(slot, timeZone);
  return Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86_400_000);
}

export function summarize(slots: Slot[], measuredAt: Date, timeZone: string = STOCKHOLM): SlotSummary {
  const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const count = (lastDay: number) =>
    sorted.filter((s) => dayIndex(measuredAt, s.start, timeZone) <= lastDay).length;
  const first = sorted[0];
  return {
    slots7: count(6),
    slots14: count(13),
    slots30: count(29),
    firstFreeAt: first?.start ?? null,
    firstFreeDays: first ? dayIndex(measuredAt, first.start, timeZone) : null,
  };
}

const key = (s: Slot) => `${s.caregiverId}|${s.procedureId}|${s.start.getTime()}`;

export type Comparison = {
  /** Booking-system slots within 14 days that patients can't book on the web. */
  slotsNotOnline: number;
  /** Booking-system-only slots in the window's first 2 hours, counted apart (plan 6.3). */
  earlyOnly: number;
};

/**
 * Compares the sources over the shared window. When the treatment is not online
 * on the web, every booking-system slot within 14 days counts (plan 5.3).
 */
export function compareSlots(
  web: Slot[],
  epr: Slot[],
  window: MeasurementWindow,
  measuredAt: Date,
  timeZone: string = STOCKHOLM,
): Comparison {
  const inWindow = (s: Slot) => s.start >= window.from && s.start < window.to;
  const within14 = (s: Slot) => dayIndex(measuredAt, s.start, timeZone) <= 13;
  const webKeys = new Set(web.filter(inWindow).map(key));
  const earlyEnd = window.from.getTime() + 2 * 60 * 60_000;
  let slotsNotOnline = 0;
  let earlyOnly = 0;
  for (const slot of epr) {
    if (!inWindow(slot) || !within14(slot) || webKeys.has(key(slot))) continue;
    if (slot.start.getTime() < earlyEnd && webKeys.size > 0) earlyOnly++;
    else slotsNotOnline++;
  }
  return { slotsNotOnline, earlyOnly };
}
