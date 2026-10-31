import { describe, expect, it } from "vitest";

import { availabilityDecision, guardDecision } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("availabilityDecision", () => {
  it("measures the even Swedish hour in winter (UTC+1)", () => {
    const decision = availabilityDecision(at("2026-11-02T07:00:00Z"));
    expect(decision).toEqual({ kind: "measure", point: at("2026-11-02T07:00:00Z") });
  });

  it("measures the even Swedish hour in summer (UTC+2)", () => {
    const decision = availabilityDecision(at("2026-07-01T06:00:00Z"));
    expect(decision).toEqual({ kind: "measure", point: at("2026-07-01T06:00:00Z") });
  });

  it("keeps the hour when Hobby starts the job late in it", () => {
    const decision = availabilityDecision(at("2026-11-02T07:59:30Z"));
    expect(decision).toEqual({ kind: "measure", point: at("2026-11-02T07:00:00Z") });
  });

  it("retries the hour before in an odd hour", () => {
    const decision = availabilityDecision(at("2026-11-02T08:10:00Z"));
    expect(decision).toEqual({ kind: "retry", point: at("2026-11-02T07:00:00Z") });
  });

  it("covers 06 and 22, and retries 22 at 23", () => {
    expect(availabilityDecision(at("2026-11-02T05:00:00Z"))).toMatchObject({ kind: "measure" });
    expect(availabilityDecision(at("2026-11-02T21:00:00Z"))).toMatchObject({ kind: "measure" });
    expect(availabilityDecision(at("2026-11-02T22:30:00Z"))).toEqual({
      kind: "retry",
      point: at("2026-11-02T21:00:00Z"),
    });
  });

  it("does nothing outside 06-23 Swedish time", () => {
    expect(availabilityDecision(at("2026-11-02T04:00:00Z"))).toEqual({ kind: "none" });
    expect(availabilityDecision(at("2026-11-02T23:00:00Z"))).toEqual({ kind: "none" });
    expect(availabilityDecision(at("2026-07-01T03:00:00Z"))).toEqual({ kind: "none" });
  });

  it("handles the day summer time starts and ends", () => {
    // 29 March 2026: clocks go from 02:00 to 03:00. 08 Swedish time is 06 UTC.
    expect(availabilityDecision(at("2026-03-29T06:00:00Z"))).toEqual({
      kind: "measure",
      point: at("2026-03-29T06:00:00Z"),
    });
    // 25 October 2026: clocks go from 03:00 to 02:00. 08 Swedish time is 07 UTC.
    expect(availabilityDecision(at("2026-10-25T07:00:00Z"))).toEqual({
      kind: "measure",
      point: at("2026-10-25T07:00:00Z"),
    });
  });
});

describe("guardDecision", () => {
  it("runs at 09 UTC and retries the same point at 10 UTC", () => {
    expect(guardDecision(at("2026-11-02T09:40:00Z"))).toEqual({
      kind: "measure",
      point: at("2026-11-02T09:00:00Z"),
    });
    expect(guardDecision(at("2026-11-02T10:05:00Z"))).toEqual({
      kind: "retry",
      point: at("2026-11-02T09:00:00Z"),
    });
    expect(guardDecision(at("2026-11-02T11:00:00Z"))).toEqual({ kind: "none" });
  });
});
