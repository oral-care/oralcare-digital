import {
  availabilityStatus,
  clinicStatus,
  waitingTimeStatus,
  type Availability,
  type ClinicStatus,
  type Thresholds,
  type WaitingTime,
} from "./statuses";

// The figures on the Availability pages (plan 4.4-4.7 and 5), from one
// measurement or one day's daily values: per pair what patients see on
// oralcare.se, what Muntra has and the slots not online; per clinic its
// statuses; per treatment the totals; and the parts of Month ahead. A value
// that could not be measured is unknown, never 0 (plan 6.4). Pure module.

export type MeasurementStatus = "measured" | "not_offered" | "could_not_be_measured";

/** One of the chart's seven fixed line colours, --chart-1 to --chart-7 (plan 4.4). */
export type ChartColor = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type WebValue = {
  status: MeasurementStatus;
  slots14: number | null;
  /** Only the latest measurement has it; daily values don't keep it. */
  slots30: number | null;
  firstFreeDays: number | null;
  availability: Availability | null;
  waitingTime: WaitingTime | null;
};

export type EprValue = { status: MeasurementStatus; slots14: number | null };

export type PairValue = {
  clinicId: number;
  treatmentId: number;
  web: WebValue | null;
  epr: EprValue | null;
  slotsNotOnline: number | null;
};

/** A web value's statuses with the thresholds that apply (plan 5.2), as the daily value gets them. */
export function withStatuses(
  web: Omit<WebValue, "availability" | "waitingTime">,
  thresholds: Thresholds,
): WebValue {
  const measured = web.status === "measured";
  return {
    ...web,
    availability: measured ? availabilityStatus(web.slots14 ?? 0, thresholds) : null,
    waitingTime: measured ? waitingTimeStatus(web.firstFreeDays, thresholds) : null,
  };
}

/** What patients see (plan 5.1): online with slots within 14 days, not online, or unknown. */
export type WebState = "online" | "notOnline" | "unknown";

export function webState(pair: PairValue | undefined): WebState {
  const web = pair?.web;
  if (!web || web.status === "not_offered") return "notOnline";
  if (web.status === "could_not_be_measured") return "unknown";
  return (web.slots14 ?? 0) > 0 ? "online" : "notOnline";
}

/**
 * In Muntra (plan 5.1 and 6.4): a pair Muntra was asked for is activated, since
 * no slots and nobody with the treatment activated is saved as not offered.
 */
export type EprState = "activated" | "notActivated" | "unknown";

export function eprState(pair: PairValue | undefined): EprState {
  const epr = pair?.epr;
  if (!epr || epr.status === "not_offered") return "notActivated";
  if (epr.status === "could_not_be_measured") return "unknown";
  return "activated";
}

export type ClinicAvailability = ClinicStatus<Availability> | "unknown";
export type ClinicWaitingTime = ClinicStatus<WaitingTime> | "unknown";
export type ClinicStatuses = { availability: ClinicAvailability; waitingTime: ClinicWaitingTime };

/**
 * A clinic's statuses from its pairs (plan 5.2). Only treatments that are
 * online count. Unknown when nothing about the clinic could be measured.
 */
export function clinicStatuses(pairs: PairValue[], snapshotEmpty = false): ClinicStatuses {
  const states = pairs.map(webState);
  if (snapshotEmpty || (states.length > 0 && states.every((s) => s === "unknown"))) {
    return { availability: "unknown", waitingTime: "unknown" };
  }
  const online = pairs.filter((_, i) => states[i] === "online");
  return {
    availability: clinicStatus(online.map((p) => p.web?.availability ?? null)),
    waitingTime: clinicStatus(online.map((p) => p.web?.waitingTime ?? null)),
  };
}

/** Weakest first (plan 4.4 and 4.5): Low, Mixed, Good, then Not online. */
export const AVAILABILITY_RANK: Record<ClinicAvailability, number> = {
  low: 0,
  mixed: 1,
  good: 2,
  notOnline: 3,
  unknown: 4,
};
export const WAITING_RANK: Record<ClinicWaitingTime, number> = {
  long: 0,
  mixed: 1,
  short: 2,
  notOnline: 3,
  unknown: 4,
};

/** The counts on the eight cards (plan 4.4). Every clinic is counted once per row. */
export type CardCounts = {
  good: number;
  mixed: number;
  low: number;
  slotsNotOnline: number;
  short: number;
  mixedWait: number;
  long: number;
  notOnline: number;
};

export function cardCounts(statuses: ClinicStatuses[], clinicsWithSlotsNotOnline: number): CardCounts {
  const count = (test: (s: ClinicStatuses) => boolean) => statuses.filter(test).length;
  return {
    good: count((s) => s.availability === "good"),
    mixed: count((s) => s.availability === "mixed"),
    low: count((s) => s.availability === "low"),
    slotsNotOnline: clinicsWithSlotsNotOnline,
    short: count((s) => s.waitingTime === "short"),
    mixedWait: count((s) => s.waitingTime === "mixed"),
    long: count((s) => s.waitingTime === "long"),
    notOnline: count((s) => s.availability === "notOnline"),
  };
}

/** The lower middle value, as the prototype; null without values (plan 5.5, Typical wait). */
export function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)]! : null;
}

const mean = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length > 0 ? known.reduce((sum, v) => sum + v, 0) / known.length : null;
};

/**
 * Vs previous period (plan 5.5): the average of the daily values in the
 * period against as many days just before, in whole percent. Null is n/a.
 */
export function changeFromPrevious(period: (number | null)[], previous: (number | null)[]): number | null {
  const now = mean(period);
  const before = mean(previous);
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** Month ahead (plan 5.6): the parts of the text, from the slots within 30 days on oralcare.se. */
export type MonthAhead =
  | { kind: "none" }
  | { kind: "single"; total: number; clinic: string }
  | {
      kind: "many";
      total: number;
      clinics: number;
      regions: number;
      /** Only with more than one region. */
      largestRegion: { name: string; clinics: number; share: number } | null;
      smallestRegion: { name: string; clinics: number; share: number } | null;
      mostClinic: { name: string; share: number };
      fewestClinic: { name: string; slots: number };
    };

export function monthAhead(
  pairs: PairValue[],
  clinics: Map<number, { name: string; region: string }>,
): MonthAhead {
  const byClinic = new Map<number, number>();
  for (const pair of pairs) {
    if (pair.web?.status !== "measured" || !clinics.has(pair.clinicId)) continue;
    byClinic.set(pair.clinicId, (byClinic.get(pair.clinicId) ?? 0) + (pair.web.slots30 ?? 0));
  }
  const withSlots = [...byClinic].filter(([, slots]) => slots > 0);
  const total = withSlots.reduce((sum, [, slots]) => sum + slots, 0);
  if (total === 0) return { kind: "none" };
  const name = (id: number) => clinics.get(id)!.name;
  if (withSlots.length === 1) return { kind: "single", total, clinic: name(withSlots[0]![0]) };

  const regions = new Map<string, { slots: number; clinics: number }>();
  for (const [id, slots] of withSlots) {
    const region = clinics.get(id)!.region;
    const sum = regions.get(region) ?? { slots: 0, clinics: 0 };
    regions.set(region, { slots: sum.slots + slots, clinics: sum.clinics + 1 });
  }
  // Most first; ties by name, so the text never changes between loads.
  const byRegion = [...regions].sort((a, b) => b[1].slots - a[1].slots || a[0].localeCompare(b[0], "sv"));
  const byClinicSlots = withSlots.sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0]), "sv"));
  const share = (slots: number) => (slots / total) * 100;
  const region = ([regionName, sum]: [string, { slots: number; clinics: number }]) => ({
    name: regionName,
    clinics: sum.clinics,
    share: share(sum.slots),
  });
  const [mostId, mostSlots] = byClinicSlots[0]!;
  const [fewestId, fewestSlots] = byClinicSlots[byClinicSlots.length - 1]!;
  return {
    kind: "many",
    total,
    clinics: withSlots.length,
    regions: regions.size,
    largestRegion: regions.size > 1 ? region(byRegion[0]!) : null,
    smallestRegion: regions.size > 1 ? region(byRegion[byRegion.length - 1]!) : null,
    mostClinic: { name: name(mostId), share: share(mostSlots) },
    fewestClinic: { name: name(fewestId), slots: fewestSlots },
  };
}
