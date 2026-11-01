import { describe, expect, it } from "vitest";

import { yesterday } from "./day";

// The guard's day in Swedish time, also across the changes to and from summer time.

describe("yesterday", () => {
  it("is the Swedish day before, with its nine schedule points", () => {
    const day = yesterday(new Date("2026-11-02T09:00:00Z"));
    expect(day.day).toBe("2026-11-01");
    expect(day.start).toEqual(new Date("2026-10-31T23:00:00Z"));
    expect(day.end).toEqual(new Date("2026-11-01T23:00:00Z"));
    expect(day.points[0]).toEqual(new Date("2026-11-01T05:00:00Z"));
    expect(day.points.at(-1)).toEqual(new Date("2026-11-01T21:00:00Z"));
    expect(day.utcDay).toBe("2026-11-01");
    expect(day.isSunday).toBe(true);
  });

  it("keeps the points on the Swedish hours on the day summer time ends", () => {
    const day = yesterday(new Date("2026-10-26T09:00:00Z"));
    expect(day.day).toBe("2026-10-25");
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * 60 * 60_000);
    expect(day.points[0]).toEqual(new Date("2026-10-25T05:00:00Z"));
    expect(day.isSunday).toBe(true);
  });

  it("knows a weekday", () => {
    expect(yesterday(new Date("2026-11-04T09:00:00Z")).isSunday).toBe(false);
  });
});
