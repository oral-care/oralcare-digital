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
} from "./figures";
import type { Sort } from "./filters";
import type { WaitingTime } from "./statuses";

// The rows of the Availability tables (plan 4.4-4.7), built from the values
// of one measurement or day and the daily sums. Pure module: the pages read
// the data and the components only show the rows.

export type ClinicRef = { id: number; name: string; region: string };
export type TreatmentRef = { id: number; name: string };

/** When the first slot is: days from today, or none within 30 days. */
export type FirstFree = { days: number } | "none";

const firstFree = (days: number | null): FirstFree => (days === null ? "none" : { days });

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

export type TreatmentRow = {
  treatment: TreatmentRef;
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
    const measured = input.pairs.filter(
      (p) => p.treatmentId === treatment.id && input.clinics.has(p.clinicId) && p.web?.status === "measured",
    );
    if (measured.length === 0) return [];
    const online = measured.filter((p) => webState(p) === "online");
    const waits = online.map((p) => p.web?.firstFreeDays).filter((d): d is number => d != null);
    const spark = input.spark(treatment.id);
    return [
      {
        treatment,
        freeSlots: measured.reduce((sum, p) => sum + (p.web?.slots14 ?? 0), 0),
        onlineAt: online.length,
        clinics: input.clinics.size,
        typicalWait: online.length > 0 ? firstFree(median(waits)) : null,
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
  /** Only when one treatment is chosen. */
  single: { slots: number | null; firstFree: FirstFree | null; spark: (number | null)[] } | null;
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
              slots: measured ? (chosen?.web?.slots14 ?? 0) : null,
              firstFree: measured ? firstFree(chosen?.web?.firstFreeDays ?? null) : null,
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
  slotsNotOnline: number;
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
      slotsNotOnline: pairs.reduce((sum, p) => sum + (p.slotsNotOnline ?? 0), 0),
    };
  });
  const byName = (a: ClinicListRow, b: ClinicListRow) => a.clinic.name.localeCompare(b.clinic.name, "sv");
  const compare: Record<Sort["key"], (a: ClinicListRow, b: ClinicListRow) => number> = {
    online: (a, b) => a.online - b.online,
    availability: (a, b) =>
      AVAILABILITY_RANK[a.statuses.availability] - AVAILABILITY_RANK[b.statuses.availability],
    wait: (a, b) => WAITING_RANK[a.statuses.waitingTime] - WAITING_RANK[b.statuses.waitingTime],
    notOnline: (a, b) => b.slotsNotOnline - a.slotsNotOnline,
  };
  const sort = input.sort;
  if (!sort) return rows.sort(byName);
  return rows.sort((a, b) => (sort.desc ? -1 : 1) * compare[sort.key](a, b) || byName(a, b));
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
    } else if (site === "notOnline") {
      if ((notOnline ?? 0) > 0) availability = { kind: "slotsNotOnline", slots: notOnline ?? 0 };
      else if (activated) availability = { kind: "noSlotsInMuntra", attention: false };
    }
    let first: ClinicTreatmentRow["firstFree"] = null;
    if (site === "online") first = firstFree(pair?.web?.firstFreeDays ?? null);
    else if (site === "unknown") first = "unknown";
    else if (activated && (inMuntra ?? 0) > 0) first = "zero";
    return {
      treatment,
      site,
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
    inMuntra: number | null;
    since: string | null;
  }[];
}): HiddenGroup[] {
  return input.clinics.flatMap((clinic) => {
    const rows = input.treatments.flatMap((treatment) => {
      const row = input.rows.find((r) => r.clinicId === clinic.id && r.treatmentId === treatment.id);
      return row ? [{ treatment, onSite: row.onSite, inMuntra: row.inMuntra, since: row.since }] : [];
    });
    return rows.length > 0 ? [{ clinic, rows }] : [];
  });
}
