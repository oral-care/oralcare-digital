import { describe, expect, it } from "vitest";

import { compareSlots, dayIndex, summarize, type Slot } from "./compare";
import { availabilityStatus, waitingTimeStatus } from "./statuses";
import { estimateLeadMinutes, measurementWindow, roundUpToFiveMinutes, splitForMuntra } from "./window";

const at = (iso: string) => new Date(iso);
const slot = (iso: string, caregiverId = "c1", procedureId = "1"): Slot => ({
  start: at(iso),
  caregiverId,
  procedureId,
});

describe("window", () => {
  it("starts after oralcare.se's own start, with margin", () => {
    // 10:02 + (20 + 5) min = 10:27, rounded up to 10:30, plus 5 = 10:35.
    const window = measurementWindow(at("2026-11-02T10:02:00Z"), 20, 90);
    expect(window.from).toEqual(at("2026-11-02T10:35:00Z"));
    expect(window.to).toEqual(at("2026-12-02T10:35:00Z"));
  });

  it("never reaches beyond how far ahead patients can book", () => {
    const window = measurementWindow(at("2026-11-02T10:00:00Z"), 20, 14);
    expect(window.to).toEqual(at("2026-11-16T10:00:00Z"));
  });

  it("estimates L from the shortest distance, within bounds", () => {
    expect(estimateLeadMinutes(null)).toBe(20);
    expect(estimateLeadMinutes(68)).toBe(63);
    expect(estimateLeadMinutes(12)).toBe(20);
    expect(estimateLeadMinutes(2000)).toBe(180);
  });

  it("splits windows longer than 30 days for Muntra", () => {
    const parts = splitForMuntra({ from: at("2026-11-01T00:00:00Z"), to: at("2027-01-15T00:00:00Z") });
    expect(parts).toHaveLength(3);
    expect(parts[0]!.to).toEqual(at("2026-12-01T00:00:00Z"));
    expect(parts.at(-1)!.to).toEqual(at("2027-01-15T00:00:00Z"));
  });

  it("rounds up to 5 minutes", () => {
    expect(roundUpToFiveMinutes(Date.parse("2026-11-02T10:00:00Z"))).toBe(Date.parse("2026-11-02T10:00:00Z"));
    expect(roundUpToFiveMinutes(Date.parse("2026-11-02T10:00:01Z"))).toBe(Date.parse("2026-11-02T10:05:00Z"));
  });
});

describe("days and counts", () => {
  it("counts calendar days in Swedish time, today is day 0", () => {
    // Monday 08:00 in Stockholm, first slot Thursday: 3 days (plan 5.4).
    expect(dayIndex(at("2026-11-02T07:00:00Z"), at("2026-11-05T15:00:00Z"))).toBe(3);
    // 23:30 Swedish time is still the same day, though it is the next day nowhere else.
    expect(dayIndex(at("2026-11-02T07:00:00Z"), at("2026-11-02T22:30:00Z"))).toBe(0);
    expect(dayIndex(at("2026-11-02T07:00:00Z"), at("2026-11-02T23:30:00Z"))).toBe(1);
  });

  it("counts within 7, 14 and 30 days and finds the first slot", () => {
    const measured = at("2026-11-02T07:00:00Z");
    const summary = summarize(
      [
        slot("2026-11-20T08:00:00Z"),
        slot("2026-11-02T13:00:00Z"),
        slot("2026-11-15T08:00:00Z"),
        slot("2026-12-10T08:00:00Z"),
      ],
      measured,
    );
    expect(summary).toMatchObject({ slots7: 1, slots14: 2, slots30: 3, firstFreeDays: 0 });
    expect(summary.firstFreeAt).toEqual(at("2026-11-02T13:00:00Z"));
  });
});

describe("compareSlots", () => {
  const measured = at("2026-11-02T07:00:00Z");
  const window = { from: at("2026-11-02T07:35:00Z"), to: at("2026-12-02T07:35:00Z") };

  it("counts booking-system slots that the web doesn't show, per caregiver and start", () => {
    const web = [slot("2026-11-03T08:00:00Z", "c1")];
    const epr = [
      slot("2026-11-03T08:00:00Z", "c1"),
      slot("2026-11-03T08:00:00Z", "c2"),
      slot("2026-11-04T08:00:00Z", "c1"),
    ];
    expect(compareSlots(web, epr, window, measured)).toEqual({ slotsNotOnline: 2, earlyOnly: 0 });
  });

  it("counts every booking-system slot when the treatment is not online", () => {
    const epr = [slot("2026-11-02T08:00:00Z"), slot("2026-11-03T08:00:00Z")];
    expect(compareSlots([], epr, window, measured)).toEqual({ slotsNotOnline: 2, earlyOnly: 0 });
  });

  it("keeps slots in the window's first 2 hours apart when the web has slots", () => {
    const web = [slot("2026-11-03T08:00:00Z")];
    const epr = [slot("2026-11-02T08:00:00Z", "c9"), slot("2026-11-03T08:00:00Z")];
    expect(compareSlots(web, epr, window, measured)).toEqual({ slotsNotOnline: 0, earlyOnly: 1 });
  });

  it("ignores slots beyond 14 days and outside the window", () => {
    const epr = [slot("2026-11-02T07:00:00Z"), slot("2026-11-20T08:00:00Z")];
    expect(compareSlots([], epr, window, measured)).toEqual({ slotsNotOnline: 0, earlyOnly: 0 });
  });
});

describe("statuses", () => {
  const other = { goodMinSlots: 11, shortMaxDays: 3 };
  const akut = { goodMinSlots: 11, shortMaxDays: 0 };

  it("sets availability at the thresholds", () => {
    expect(availabilityStatus(0, other)).toBeNull();
    expect(availabilityStatus(1, other)).toBe("low");
    expect(availabilityStatus(10, other)).toBe("low");
    expect(availabilityStatus(11, other)).toBe("good");
  });

  it("sets waiting time, same day for Akut and 3 days for others", () => {
    expect(waitingTimeStatus(null, other)).toBeNull();
    expect(waitingTimeStatus(3, other)).toBe("short");
    expect(waitingTimeStatus(4, other)).toBe("long");
    expect(waitingTimeStatus(0, akut)).toBe("short");
    expect(waitingTimeStatus(1, akut)).toBe("long");
  });
});
