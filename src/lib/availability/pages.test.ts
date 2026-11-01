import { describe, expect, it } from "vitest";

import { addDays, daySpan, dayLabel, monthStart, shortDate, weekday } from "@/lib/time";

import {
  cardCounts,
  changeFromPrevious,
  clinicStatuses,
  median,
  monthAhead,
  withStatuses,
  type PairValue,
  type WebValue,
} from "./figures";
import { filterSearch, parseFilters, periodRange, previousRange, DEFAULT_FILTERS } from "./filters";
import { formatChange, formatCount, formatShare } from "./format";
import { clinicListRows, clinicRows, clinicTreatmentRows, hiddenGroups, treatmentRows } from "./views";

// The rules behind the Availability pages (plan 4.4-4.7 and 5).

const thresholds = { goodMinSlots: 11, shortMaxDays: 3 };
const web = (slots14: number | null, firstFreeDays: number | null = 1, slots30 = 0): WebValue =>
  withStatuses(
    { status: slots14 === null ? "not_offered" : "measured", slots14, slots30, firstFreeDays },
    thresholds,
  );
const pair = (
  clinicId: number,
  treatmentId: number,
  values: { web?: WebValue | null; epr?: number | null; hidden?: number | null } = {},
): PairValue => ({
  clinicId,
  treatmentId,
  web: values.web ?? null,
  epr: values.epr === undefined || values.epr === null ? null : { status: "measured", slots14: values.epr },
  slotsNotOnline: values.hidden ?? null,
});

describe("days", () => {
  it("counts calendar days without time zones", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daySpan("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(monthStart("2026-11-15", -1)).toBe("2026-10-01");
    expect(weekday("2026-11-02")).toBe(0);
  });

  it("writes dates as on the pages", () => {
    expect(dayLabel("2026-10-31")).toBe("Sat 31 Oct");
    expect(shortDate("2026-09-29")).toBe("29 Sep");
  });
});

describe("filters in the address", () => {
  it("reads and writes the filters, without the defaults", () => {
    const filters = parseFilters({ c: "3,1,1,x", t: "2", p: "7", v: "clinic", sort: "-wait", hide: "2,all" });
    expect(filters).toMatchObject({
      clinics: [1, 3],
      treatments: [2],
      period: "7",
      view: "clinic",
      sort: { key: "wait", desc: true },
      hidden: ["2", "all"],
    });
    expect(filterSearch(filters)).toBe("?c=1,3&t=2&p=7&v=clinic&sort=-wait&hide=2,all");
    expect(filterSearch(DEFAULT_FILTERS)).toBe("");
  });

  it("falls back to the default for anything that doesn't parse", () => {
    expect(parseFilters({ p: "year", v: "map", sort: "name", from: "2026-02-30" })).toEqual(DEFAULT_FILTERS);
    // A custom period without both days is the default period.
    expect(parseFilters({ p: "custom", from: "2026-10-01" }).period).toBe("30");
  });

  it("turns the period into days", () => {
    const today = "2026-11-01";
    const range = (p: string, extra: Record<string, string> = {}) =>
      periodRange(parseFilters({ p, ...extra }), today, "2026-08-01");
    expect(range("7")).toEqual({ from: "2026-10-26", to: today });
    expect(range("30")).toEqual({ from: "2026-10-03", to: today });
    expect(range("month")).toEqual({ from: "2026-11-01", to: today });
    expect(range("last")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    // A custom period stays between the first measured day and today, in either order.
    expect(range("custom", { from: "2026-12-01", to: "2026-07-01" })).toEqual({
      from: "2026-08-01",
      to: today,
    });
    expect(previousRange({ from: "2026-10-26", to: today })).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
  });
});

describe("figures", () => {
  it("gives a clinic the status its online treatments share, or Mixed", () => {
    expect(clinicStatuses([pair(1, 1, { web: web(20) }), pair(1, 2, { web: web(15) })])).toEqual({
      availability: "good",
      waitingTime: "short",
    });
    expect(clinicStatuses([pair(1, 1, { web: web(20) }), pair(1, 2, { web: web(4, 8) })])).toEqual({
      availability: "mixed",
      waitingTime: "mixed",
    });
    // A treatment with 0 slots is not online and doesn't count.
    expect(
      clinicStatuses([pair(1, 1, { web: web(20) }), pair(1, 2, { web: web(0, null) })]).availability,
    ).toBe("good");
    expect(clinicStatuses([pair(1, 1, { web: web(null) })]).availability).toBe("notOnline");
    expect(clinicStatuses([], true).availability).toBe("unknown");
  });

  it("counts every clinic once per row of cards", () => {
    const statuses = [
      { availability: "good", waitingTime: "short" },
      { availability: "notOnline", waitingTime: "notOnline" },
      { availability: "unknown", waitingTime: "unknown" },
    ] as const;
    expect(cardCounts([...statuses], 1)).toEqual({
      good: 1,
      mixed: 0,
      low: 0,
      slotsNotOnline: 1,
      short: 1,
      mixedWait: 0,
      long: 0,
      notOnline: 1,
    });
  });

  it("takes the lower middle value and compares periods by their averages", () => {
    expect(median([5, 0, 1, 8])).toBe(1);
    expect(median([])).toBeNull();
    expect(changeFromPrevious([110, null, 110], [100, 100])).toBe(10);
    expect(changeFromPrevious([10], [null])).toBeNull();
    expect(changeFromPrevious([10], [0])).toBeNull();
  });

  it("writes Month ahead from the slots within 30 days", () => {
    const clinics = new Map([
      [1, { name: "A", region: "Norr" }],
      [2, { name: "B", region: "Norr" }],
      [3, { name: "C", region: "Syd" }],
    ]);
    const ahead = monthAhead(
      [
        pair(1, 1, { web: web(10, 1, 60) }),
        pair(2, 1, { web: web(10, 1, 30) }),
        pair(3, 1, { web: web(5, 1, 10) }),
        pair(3, 2, { web: web(null) }),
      ],
      clinics,
    );
    expect(ahead).toEqual({
      kind: "many",
      total: 100,
      clinics: 3,
      regions: 2,
      largestRegion: { name: "Norr", clinics: 2, share: 90 },
      smallestRegion: { name: "Syd", clinics: 1, share: 10 },
      mostClinic: { name: "A", share: 60 },
      fewestClinic: { name: "C", slots: 10 },
    });
    expect(monthAhead([pair(1, 1, { web: web(10, 1, 7) })], clinics)).toEqual({
      kind: "single",
      total: 7,
      clinic: "A",
    });
    expect(monthAhead([pair(1, 1, { web: web(0, null, 0) })], clinics)).toEqual({ kind: "none" });
  });

  it("formats numbers in English", () => {
    expect(formatCount(3339)).toBe("3,339");
    expect(formatShare(23.14)).toBe("23.1%");
    expect(formatChange(12)).toBe("+12%");
    expect(formatChange(-5)).toBe("-5%");
  });
});

describe("table rows", () => {
  const clinics = [
    { id: 1, name: "Alfa", region: "Norr" },
    { id: 2, name: "Beta", region: "Norr" },
    { id: 3, name: "Gamma", region: "Syd" },
  ];
  const treatments = [
    { id: 1, name: "Undersökning" },
    { id: 2, name: "Akut" },
  ];
  const pairs = [
    pair(1, 1, { web: web(20, 0), epr: 20, hidden: 0 }),
    pair(1, 2, { web: web(12, 1), epr: 12, hidden: 0 }),
    pair(2, 1, { web: web(4, 6), epr: 9, hidden: 5 }),
    pair(3, 2, { web: web(null), epr: 3, hidden: 3 }),
  ];

  it("By treatment sums the clinics in the filter", () => {
    const rows = treatmentRows({
      treatments,
      pairs,
      clinics: new Set([1, 2, 3]),
      spark: () => [1, 2],
      previous: () => [1, 1],
    });
    expect(rows.map((r) => [r.treatment.name, r.freeSlots, r.onlineAt, r.clinics, r.typicalWait])).toEqual([
      ["Undersökning", 24, 2, 3, { days: 0 }],
      ["Akut", 12, 1, 3, { days: 1 }],
    ]);
    expect(rows[0]?.change).toBe(50);
  });

  it("By clinic puts the weakest first", () => {
    const rows = clinicRows({
      clinics,
      treatments,
      pairs,
      snapshotEmpty: false,
      single: null,
      spark: () => [],
    });
    expect(rows.map((r) => [r.clinic.name, r.statuses.availability, r.online, r.fewest])).toEqual([
      ["Beta", "low", 1, { treatment: "Undersökning", slots: 4 }],
      ["Alfa", "good", 2, { treatment: "Akut", slots: 12 }],
      ["Gamma", "notOnline", 0, null],
    ]);
  });

  it("Clinics sorts by a column with the weakest first, and reverses", () => {
    const sorted = (key: "online" | "notOnline", desc = false) =>
      clinicListRows({ clinics, treatments, pairs, snapshotEmpty: false, sort: { key, desc } }).map(
        (r) => r.clinic.name,
      );
    expect(
      clinicListRows({ clinics, treatments, pairs, snapshotEmpty: false, sort: null }).map(
        (r) => r.clinic.name,
      ),
    ).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(sorted("online")).toEqual(["Gamma", "Beta", "Alfa"]);
    expect(sorted("notOnline")).toEqual(["Beta", "Gamma", "Alfa"]);
    expect(sorted("notOnline", true)).toEqual(["Alfa", "Gamma", "Beta"]);
  });

  it("a clinic's page follows the rules for every column", () => {
    const rows = clinicTreatmentRows({
      clinicId: 3,
      treatments: [...treatments, { id: 3, name: "Tandblekning" }],
      pairs: [...pairs, pair(3, 1, { web: web(0, null), epr: 0, hidden: 0 }), pair(3, 3, { web: web(5, 2) })],
    });
    expect(
      rows.map((r) => [
        r.treatment.name,
        r.site,
        r.muntra,
        r.slotsInMuntra,
        r.slotsNotOnline,
        r.firstFree,
        r.availability,
        r.waitingTime,
      ]),
    ).toEqual([
      // Activated with 0 slots: Slots not online and First free slot stay empty.
      [
        "Undersökning",
        "notOnline",
        "activated",
        0,
        null,
        null,
        { kind: "noSlotsInMuntra", attention: false },
        null,
      ],
      // Not online, but Muntra has slots: all of them are not online.
      ["Akut", "notOnline", "activated", 3, 3, "zero", { kind: "slotsNotOnline", slots: 3 }, null],
      // Online but not activated in Muntra.
      [
        "Tandblekning",
        "online",
        "notActivated",
        null,
        null,
        { days: 2 },
        { kind: "noSlotsInMuntra", attention: true },
        "short",
      ],
    ]);
  });

  it("Patient vs Muntra groups the rows per clinic, by name", () => {
    const groups = hiddenGroups({
      clinics,
      treatments,
      rows: [
        { clinicId: 3, treatmentId: 2, onSite: null, inMuntra: 3, since: "2026-10-12" },
        { clinicId: 2, treatmentId: 1, onSite: 4, inMuntra: 9, since: "2026-10-27" },
      ],
    });
    expect(groups.map((g) => [g.clinic.name, g.rows.map((r) => r.treatment.name)])).toEqual([
      ["Beta", ["Undersökning"]],
      ["Gamma", ["Akut"]],
    ]);
  });
});
