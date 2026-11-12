import {
  AVAILABILITY_RANK,
  changeFromPrevious,
  clinicStatuses,
  eprState,
  median,
  WAITING_RANK,
  webState,
  type ClinicStatuses,
  type EprState,
  type PairValue,
  type WebState,
  type WebValue,
} from "./figures";
import type { Sort } from "./filters";
import type { WaitingTime } from "./statuses";
import { WINDOW_DAYS } from "./window";

// The rows of the Availability tables (plan 4.4-4.7), built from the values
// of one measurement or day and the daily sums. Pure module: the pages read
// the data and the components only show the rows.

export type ClinicRef = { id: number; name: string; region: string };
export type TreatmentRef = { id: number; name: string };

/** When the first slot is: days from today, or none in the days oralcare.se was searched (plan 5.4). */
export type FirstFree = { days: number } | { noneIn: number };

const firstFree = (web: WebValue | null | undefined): FirstFree =>
  web?.firstFreeDays != null ? { days: web.firstFreeDays } : { noneIn: web?.searchedDays ?? WINDOW_DAYS };

const pairKey = (clinicId: number, treatmentId: number) => `${clinicId}|${treatmentId}`;

export function pairIndex(pairs: PairValue[]): Map<string, PairValue> {
  return new Map(pairs.map((p) => [pairKey(p.clinicId, p.treatmentId), p]));
}

export function pairsOf(pairs: PairValue[], clinicId: number, treatments: Set<number> | null): PairValue[] {
  return pairs.filter((p) => p.clinicId === clinicId && (!treatments || treatments.has(p.treatmentId)));
}

/** Clinics with slots not online among the treatments (plan 4.4, the card). */
export function clinicsWithSlotsNotOnline(
  pairs: PairValue[],
  clinics: Set<number>,
  treatments: Set<number> | null,
): number {
  return new Set(
    pairs
      .filter(
        (p) =>
          clinics.has(p.clinicId) &&
          (!treatments || treatments.has(p.treatmentId)) &&
          (p.slotsNotOnline ?? 0) > 0,
      )
      .map((p) => p.clinicId),
  ).size;
}

/** A clinic's slots not online; null (n/a) when any of its pairs could not be compared (plan 5.7). */
export function clinicSlotsNotOnline(pairs: PairValue[]): number | null {
  if (pairs.some((p) => p.slotsNotOnline === null)) return null;
  return pairs.reduce((sum, p) => sum + (p.slotsNotOnline ?? 0), 0);
}

export type TreatmentRow = {
  treatment: TreatmentRef;
  /** Some clinic in the filter could not be measured: the totals are n/a (plan 5.7). */
  unknown: boolean;
  freeSlots: number;
  onlineAt: number;
  clinics: number;
  typicalWait: FirstFree | null;
  spark: (number | null)[];
  change: number | null;
};

/**
 * By treatment (plan 4.4): only treatments with data in the filter. Free
 * slots and Online at count every clinic in the filter; Typical wait only
 * those where the treatment is online.
 */
export function treatmentRows(input: {
  treatments: TreatmentRef[];
  pairs: PairValue[];
  clinics: Set<number>;
  spark: (treatmentId: number) => (number | null)[];
  previous: (treatmentId: number) => (number | null)[];
}): TreatmentRow[] {
  return input.treatments.flatMap((treatment) => {
    const inFilter = input.pairs.filter(
      (p) => p.treatmentId === treatment.id && input.clinics.has(p.clinicId),
    );
    const measured = inFilter.filter((p) => p.web?.status === "measured");
    const unknown = inFilter.some((p) => webState(p) === "unknown");
    if (measured.length === 0 && !unknown) return [];
    const online = measured.filter((p) => webState(p) === "online");
    const waits = online.map((p) => p.web?.firstFreeDays).filter((d): d is number => d != null);
    const typicalWait = median(waits);
    const spark = input.spark(treatment.id);
    return [
      {
        treatment,
        unknown,
        freeSlots: measured.reduce((sum, p) => sum + (p.web?.slots14 ?? 0), 0),
        onlineAt: online.length,
        clinics: input.clinics.size,
        typicalWait: typicalWait === null ? null : { days: typicalWait },
        spark,
        change: changeFromPrevious(spark, input.previous(treatment.id)),
      },
    ];
  });
}

export type ClinicRow = {
  clinic: ClinicRef;
  statuses: ClinicStatuses;
  /** Online treatments, out of the treatments in the filter. */
  online: number;
  treatments: number;
  fewest: { treatment: string; slots: number } | null;
  /** Only when one treatment is chosen. Unknown is n/a; null slots means it isn't offered. */
  single: {
    unknown: boolean;
    slots: number | null;
    firstFree: FirstFree | null;
    spark: (number | null)[];
  } | null;
};

/**
 * By clinic (plan 4.4): every clinic in the filter, weakest first:
 * Availability, then Waiting time, then the fewest slots.
 */
export function clinicRows(input: {
  clinics: ClinicRef[];
  treatments: TreatmentRef[];
  pairs: PairValue[];
  snapshotEmpty: boolean;
  /** The one chosen treatment, if exactly one is. */
  single: number | null;
  spark: (clinicId: number) => (number | null)[];
}): ClinicRow[] {
  const ids = new Set(input.treatments.map((t) => t.id));
  const names = new Map(input.treatments.map((t) => [t.id, t.name]));
  const rows = input.clinics.map((clinic) => {
    const pairs = pairsOf(input.pairs, clinic.id, ids);
    const online = pairs.filter((p) => webState(p) === "online");
    const weakest = [...online].sort((a, b) => (a.web?.slots14 ?? 0) - (b.web?.slots14 ?? 0))[0];
    const chosen = input.single === null ? null : pairs.find((p) => p.treatmentId === input.single);
    const measured = chosen?.web?.status === "measured";
    return {
      clinic,
      statuses: clinicStatuses(pairs, input.snapshotEmpty),
      online: online.length,
      treatments: input.treatments.length,
      fewest: weakest
        ? { treatment: names.get(weakest.treatmentId) ?? "", slots: weakest.web?.slots14 ?? 0 }
        : null,
      single:
        input.single === null
          ? null
          : {
              unknown: chosen !== undefined && chosen !== null && webState(chosen) === "unknown",
              slots: measured ? (chosen?.web?.slots14 ?? 0) : null,
              firstFree: measured ? firstFree(chosen?.web) : null,
              spark: input.spark(clinic.id),
            },
    };
  });
  const slots = (row: ClinicRow) =>
    row.single ? (row.single.slots ?? Infinity) : (row.fewest?.slots ?? Infinity);
  return rows.sort(
    (a, b) =>
      AVAILABILITY_RANK[a.statuses.availability] - AVAILABILITY_RANK[b.statuses.availability] ||
      WAITING_RANK[a.statuses.waitingTime] - WAITING_RANK[b.statuses.waitingTime] ||
      slots(a) - slots(b) ||
      a.clinic.name.localeCompare(b.clinic.name, "sv"),
  );
}

export type ClinicListRow = {
  clinic: ClinicRef;
  statuses: ClinicStatuses;
  online: number;
  treatments: number;
  /** Null is n/a: a pair could not be compared. */
  slotsNotOnline: number | null;
};

/**
 * Clinics (plan 4.5): every clinic by name, or sorted by a column with the
 * weakest first; sorting the same column again reverses it.
 */
export function clinicListRows(input: {
  clinics: ClinicRef[];
  treatments: TreatmentRef[];
  pairs: PairValue[];
  snapshotEmpty: boolean;
  sort: Sort | null;
}): ClinicListRow[] {
  const ids = new Set(input.treatments.map((t) => t.id));
  const rows = input.clinics.map((clinic) => {
    const pairs = pairsOf(input.pairs, clinic.id, ids);
    return {
      clinic,
      statuses: clinicStatuses(pairs, input.snapshotEmpty),
      online: pairs.filter((p) => webState(p) === "online").length,
      treatments: input.treatments.length,
      slotsNotOnline: clinicSlotsNotOnline(pairs),
    };
  });
  const byName = (a: ClinicListRow, b: ClinicListRow) => a.clinic.name.localeCompare(b.clinic.name, "sv");
  const compare: Record<Sort["key"], (a: ClinicListRow, b: ClinicListRow) => number> = {
    online: (a, b) => a.online - b.online,
    availability: (a, b) =>
      AVAILABILITY_RANK[a.statuses.availability] - AVAILABILITY_RANK[b.statuses.availability],
    wait: (a, b) => WAITING_RANK[a.statuses.waitingTime] - WAITING_RANK[b.statuses.waitingTime],
    notOnline: (a, b) => (b.slotsNotOnline ?? -1) - (a.slotsNotOnline ?? -1),
  };
  // A value that could not be measured (n/a) is last whichever way the column sorts.
  const unknown: Record<Sort["key"], (row: ClinicListRow) => boolean> = {
    online: (row) => row.statuses.availability === "unknown",
    availability: (row) => row.statuses.availability === "unknown",
    wait: (row) => row.statuses.waitingTime === "unknown",
    notOnline: (row) => row.slotsNotOnline === null,
  };
  const sort = input.sort;
  if (!sort) return rows.sort(byName);
  const last = unknown[sort.key];
  return rows.sort(
    (a, b) =>
      Number(last(a)) - Number(last(b)) || (sort.desc ? -1 : 1) * compare[sort.key](a, b) || byName(a, b),
  );
}

/** The Availability column on a clinic's page (plan 4.6). */
export type TreatmentAvailability =
  | { kind: "good" | "low" }
  | { kind: "slotsNotOnline"; slots: number }
  | { kind: "noSlotsInMuntra"; attention: boolean }
  | null;

export type ClinicTreatmentRow = {
  treatment: TreatmentRef;
  site: WebState;
  /** With site "later": the first slot's day, YYYY-MM-DD. */
  firstSlot: string | null;
  muntra: EprState;
  /** Empty (null) when not activated in Muntra. */
  slotsInMuntra: number | "unknown" | null;
  slotsNotOnline: number | "unknown" | null;
  /** "zero" is a treatment not online but activated in Muntra with slots. */
  firstFree: FirstFree | "zero" | "unknown" | null;
  availability: TreatmentAvailability;
  waitingTime: WaitingTime | null;
};

/** The table on a clinic's page (plan 4.6): every treatment on oralcare.se. */
export function clinicTreatmentRows(input: {
  clinicId: number;
  treatments: TreatmentRef[];
  pairs: PairValue[];
}): ClinicTreatmentRow[] {
  const index = pairIndex(input.pairs);
  return input.treatments.map((treatment) => {
    const pair = index.get(pairKey(input.clinicId, treatment.id));
    const site = webState(pair);
    const muntra = eprState(pair);
    const activated = muntra === "activated";
    const inMuntra = activated ? (pair?.epr?.slots14 ?? 0) : null;
    const notOnline = activated && inMuntra !== 0 ? (pair?.slotsNotOnline ?? null) : null;
    let availability: TreatmentAvailability = null;
    if (site === "online") {
      availability =
        muntra === "notActivated"
          ? { kind: "noSlotsInMuntra", attention: true }
          : { kind: pair?.web?.availability === "good" ? "good" : "low" };
    } else if (site === "notOnline" || site === "later") {
      if ((notOnline ?? 0) > 0) availability = { kind: "slotsNotOnline", slots: notOnline ?? 0 };
      else if (activated) availability = { kind: "noSlotsInMuntra", attention: false };
    }
    let first: ClinicTreatmentRow["firstFree"] = null;
    if (site === "online" || site === "later") first = firstFree(pair?.web);
    else if (site === "unknown") first = "unknown";
    else if (activated && (inMuntra ?? 0) > 0) first = "zero";
    return {
      treatment,
      site,
      firstSlot: site === "later" ? (pair?.web?.firstFreeDate ?? null) : null,
      muntra,
      slotsInMuntra: muntra === "unknown" ? "unknown" : inMuntra,
      slotsNotOnline: muntra === "unknown" ? "unknown" : notOnline,
      firstFree: first,
      availability,
      waitingTime: site === "online" ? (pair?.web?.waitingTime ?? null) : null,
    };
  });
}

export type HiddenGroup = {
  clinic: ClinicRef;
  rows: {
    treatment: TreatmentRef;
    onSite: number | null;
    firstSlot: string | null;
    inMuntra: number | null;
    since: string | null;
  }[];
};

/** Patient vs Muntra (plan 4.7): one group per clinic, by name, in the treatments' order. */
export function hiddenGroups(input: {
  clinics: ClinicRef[];
  treatments: TreatmentRef[];
  rows: {
    clinicId: number;
    treatmentId: number;
    onSite: number | null;
    firstSlot: string | null;
    inMuntra: number | null;
    since: string | null;
  }[];
}): HiddenGroup[] {
  return input.clinics.flatMap((clinic) => {
    const rows = input.treatments.flatMap((treatment) => {
      const row = input.rows.find((r) => r.clinicId === clinic.id && r.treatmentId === treatment.id);
      return row
        ? [
            {
              treatment,
              onSite: row.onSite,
              firstSlot: row.firstSlot,
              inMuntra: row.inMuntra,
              since: row.since,
            },
          ]
        : [];
    });
    return rows.length > 0 ? [{ clinic, rows }] : [];
  });
}
