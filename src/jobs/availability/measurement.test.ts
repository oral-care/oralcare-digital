import { describe, expect, it } from "vitest";

import type { Slot } from "@/lib/availability/compare";
import { SourceFormatError } from "@/lib/availability/sources/oralcare-se";
import { measurementWindow } from "@/lib/availability/window";

import { SourceRequestError, StopError } from "../runtime/http";
import { collect, failure } from "./collect";
import { pairKey, type Context } from "./context";
import { dailyRows, evaluate, type EvaluateInput, type PairResult } from "./evaluate";
import { defaultProcedureId, planPairs, type Pair } from "./pairs";
import { diffRegistry } from "./registry";
import type { Registry } from "./sources/types";

// The measurement's own rules, without a database or a network: what is
// compared, when it alerts, and what counts as a change (plan 5, 6 and 8.1).

const at = (iso: string) => new Date(iso);
const slot = (iso: string, caregiverId = "c1", procedureId = "1"): Slot => ({
  start: at(iso),
  caregiverId,
  procedureId,
});
// 10:00 in Stockholm. 10:25 is already on 5 minutes, so the window starts at 10:30 (09:30 UTC).
const measuredAt = at("2026-11-02T09:00:00Z");
const window = measurementWindow(measuredAt, 20, 90);
const AKUT = "muntra-treatment-23";
const CHECKUP = "muntra-checkup-1";

function context(overrides: Partial<Context> = {}): Context {
  return {
    countryId: 1,
    webSourceId: 1,
    eprSourceId: 2,
    clinics: new Map(),
    treatments: new Map(),
    regions: new Map(),
    offerings: new Map(),
    procedures: new Map(),
    shortestLeadMinutes: null,
    previousRun: null,
    previousPairs: new Map(),
    thresholds: new Map([
      [null, { id: 1, goodMinSlots: 11, shortMaxDays: 3 }],
      [AKUT, { id: 2, goodMinSlots: 11, shortMaxDays: 0 }],
    ]),
    incidentThreshold: 0.3,
    requestsToday: { web: 0, epr: 0 },
    activationFetchedAt: null,
    dailyValueExists: false,
    ...overrides,
  };
}

function pair(eprId: string, webKey = CHECKUP, webSelectable = true): Pair {
  return {
    key: pairKey(eprId, webKey),
    eprId,
    webKey,
    clinicName: `Clinic ${eprId}`,
    treatmentName: webKey,
    webSelectable,
    procedureIds: [defaultProcedureId(webKey)!],
  };
}

const answer = (slots: Slot[]) => ({
  kind: "slots" as const,
  slots,
  requestedAt: measuredAt,
  respondedAt: measuredAt,
});

function input(
  ctx: Context,
  entries: [Pair, PairResult][],
  overrides: Partial<EvaluateInput> = {},
): EvaluateInput {
  return {
    ctx,
    pairs: entries.map(([p]) => p),
    results: new Map(entries.map(([p, r]) => [p.key, r])),
    activation: new Map(),
    window,
    measuredAt,
    timeZone: "Europe/Stockholm",
    stopped: null,
    withdrawn: [],
    otherFormatProblems: [],
    maxLeadChange: null,
    ...overrides,
  };
}

describe("evaluate", () => {
  // A slot both sources have, and one only the booking system has in the window's first 2 hours.
  const shared = slot("2026-11-03T08:00:00Z");
  const early = slot("2026-11-02T09:45:00Z");
  const earlyPair = (eprId: string): [Pair, PairResult] => [
    pair(eprId),
    { web: answer([shared]), epr: answer([shared, early]) },
  ];

  it("treats early booking-system slots on 3 clinics as a window anomaly, not as slots not online", () => {
    const result = evaluate(input(context(), ["a", "b", "c"].map(earlyPair)));
    expect(result.comparisons.map((c) => c.slotsNotOnline)).toEqual([0, 0, 0]);
    expect(result.alerts).toEqual([{ type: "window_anomaly", subject: "-", payload: { clinics: 3 } }]);
  });

  it("counts early slots as not online when fewer than 3 clinics have them", () => {
    const result = evaluate(input(context(), ["a", "b"].map(earlyPair)));
    expect(result.comparisons.map((c) => c.slotsNotOnline)).toEqual([1, 1]);
    expect(result.alerts).toEqual([]);
  });

  it("registers an incident when the web shows nothing for 30 percent of the pairs with booking-system slots", () => {
    const later = slot("2026-11-04T08:00:00Z");
    const result = evaluate(
      input(context(), [
        [pair("a"), { web: answer([later]), epr: answer([later]) }],
        [pair("b"), { web: answer([later]), epr: answer([later]) }],
        [pair("c"), { web: answer([]), epr: answer([later]) }],
      ]),
    );
    expect(result.incident?.shareMissing).toBeCloseTo(1 / 3);
    const web = result.measurements.filter((m) => m.source === "web");
    expect(web.every((m) => m.status === "could_not_be_measured" && m.reason === "incident")).toBe(true);
    expect(result.comparisons.every((c) => c.slotsNotOnline === null)).toBe(true);
    expect(result.alerts.map((a) => a.type)).toEqual(["incident", "low_coverage"]);
    expect(result.coverage).toEqual({ measured: 3, expected: 6 });
  });

  it("alerts when a treatment stops being online while the booking system has slots", () => {
    const ctx = context({
      previousPairs: new Map([[pairKey("a", CHECKUP), { webOnline: true, slotsNotOnline: 0 }]]),
    });
    const result = evaluate(
      input(ctx, [[pair("a", CHECKUP, false), { web: null, epr: answer([slot("2026-11-04T08:00:00Z")]) }]]),
    );
    expect(result.measurements[0]).toMatchObject({ source: "web", status: "not_offered" });
    expect(result.comparisons[0]).toMatchObject({ webSlots: null, eprSlots: 1, slotsNotOnline: 1 });
    expect(result.alerts).toEqual([
      {
        type: "treatment_not_online",
        subject: pairKey("a", CHECKUP),
        payload: { clinic: "Clinic a", treatment: CHECKUP, slots: 1 },
      },
    ]);
  });

  it("alerts slots not online only in the second measurement in a row", () => {
    const missing: [Pair, PairResult] = [
      pair("a"),
      { web: answer([]), epr: answer([slot("2026-11-04T08:00:00Z")]) },
    ];
    const first = evaluate(input(context({ incidentThreshold: 1.1 }), [missing]));
    expect(first.alerts).toEqual([]);
    const ctx = context({
      incidentThreshold: 1.1,
      previousPairs: new Map([[pairKey("a", CHECKUP), { webOnline: false, slotsNotOnline: 1 }]]),
    });
    expect(evaluate(input(ctx, [missing])).alerts.map((a) => a.type)).toEqual(["slots_not_online"]);
  });

  it("saves no slots and nobody activated as not offered, and activated without slots as 0", () => {
    const empty: PairResult = { web: answer([]), epr: answer([]) };
    const notActivated = evaluate(
      input(
        context({
          offerings: new Map([[pairKey("a", CHECKUP), { webSelectable: true, eprActivated: false }]]),
        }),
        [[pair("a"), empty]],
      ),
    );
    expect(notActivated.measurements[1]).toMatchObject({
      source: "epr",
      status: "not_offered",
      slots14: null,
    });

    const activated = evaluate(
      input(context(), [[pair("a"), empty]], {
        activation: new Map([["a", new Map([["1", new Set(["c1", "c2"])]])]]),
      }),
    );
    expect(activated.measurements[1]).toMatchObject({
      status: "measured",
      slots14: 0,
      caregiversActivated: 2,
    });
  });

  it("names the field and types of a new format once per source and path", () => {
    const format = { source: "Muntra", path: "data.0.id", expected: "string", received: "number" };
    const broken: PairResult = {
      web: answer([]),
      epr: { kind: "failed", reason: "format", format, requestedAt: measuredAt, respondedAt: measuredAt },
    };
    const result = evaluate(
      input(context(), [
        [pair("a"), broken],
        [pair("b"), broken],
      ]),
    );
    expect(result.alerts.filter((a) => a.type === "format")).toEqual([
      { type: "format", subject: "Muntra:data.0.id", payload: { ...format, count: 2 } },
    ]);
  });

  it("flags a web slot before the request as a collector error", () => {
    const result = evaluate(
      input(context(), [[pair("a"), { web: answer([slot("2026-11-02T08:30:00Z")]), epr: answer([]) }]]),
    );
    expect(result.alerts.map((a) => a.subject)).toContain(`slot_before_window:${pairKey("a", CHECKUP)}`);
  });

  it("sets the daily statuses with the thresholds per treatment", () => {
    const tomorrow = Array.from({ length: 12 }, (_, i) =>
      slot(new Date(Date.UTC(2026, 10, 3, 8, i * 5)).toISOString(), "c1", "23"),
    );
    const result = evaluate(
      input(context(), [[pair("a", AKUT), { web: answer(tomorrow), epr: answer(tomorrow) }]]),
    );
    const [web] = dailyRows(context(), result.measurements);
    // Akut is short only on the same day, so a first slot tomorrow is long.
    expect(web).toMatchObject({
      availability: "good",
      waitingTime: "long",
      firstFreeDays: 1,
      thresholdVersionId: 2,
    });
  });
});

describe("diffRegistry", () => {
  const clinic = (eprId: string, regionInternalKey = "stockholm") => ({
    eprId,
    name: `Clinic ${eprId}`,
    city: "Stockholm",
    slug: `clinic-${eprId}`,
    regionInternalKey,
    regionName: regionInternalKey,
  });
  const registry = (clinics = [clinic("a"), clinic("b")]): Registry => ({
    treatments: [{ internalKey: CHECKUP, slug: "basundersokning", name: "Basundersökning" }],
    selectable: new Map([[CHECKUP, clinics]]),
    clinics,
    maxLeadDays: 90,
  });
  const none = { activation: new Map(), procedureIds: new Map(), eprSlots: new Map() };

  it("fills the registry on the first measurement without change events", () => {
    const writes = diffRegistry({ ctx: context(), registry: registry(), ...none });
    expect(writes.regions).toEqual([{ key: "stockholm", name: "stockholm" }]);
    expect(writes.newClinics.map((c) => c.eprId)).toEqual(["a", "b"]);
    expect(writes.newTreatments).toEqual([
      { webKey: CHECKUP, name: "Basundersökning", slug: "basundersokning" },
    ]);
    expect(writes.offerings).toHaveLength(2);
    expect(writes.procedures.map((p) => p.procedureId)).toEqual(["1", "1"]);
    expect(writes.events).toEqual([]);
  });

  it("records region changes, removed clinics and lost selectability as facts", () => {
    const stored = (eprId: string) => ({
      id: 1,
      eprId,
      slug: `clinic-${eprId}`,
      name: `Clinic ${eprId}`,
      city: "Stockholm",
      regionKey: "stockholm",
    });
    const ctx = context({
      previousRun: { id: 7, maxLeadDays: 90 },
      clinics: new Map([
        ["a", stored("a")],
        ["b", stored("b")],
      ]),
      regions: new Map([["stockholm", 1]]),
      treatments: new Map([
        [CHECKUP, { id: 1, webKey: CHECKUP, name: "Basundersökning", slug: "basundersokning" }],
      ]),
      offerings: new Map([
        [pairKey("a", CHECKUP), { webSelectable: true, eprActivated: true }],
        [pairKey("b", CHECKUP), { webSelectable: true, eprActivated: true }],
      ]),
      procedures: new Map([
        [pairKey("a", CHECKUP), new Set(["1"])],
        [pairKey("b", CHECKUP), new Set(["1"])],
      ]),
    });
    const writes = diffRegistry({
      ctx,
      registry: { ...registry([clinic("a", "uppsala")]), maxLeadDays: 60 },
      ...none,
      eprSlots: new Map([[pairKey("b", CHECKUP), 4]]),
    });
    expect(writes.regions).toEqual([{ key: "uppsala", name: "uppsala" }]);
    expect(writes.clinicRegions).toEqual([{ eprId: "a", regionKey: "uppsala" }]);
    expect(writes.clinicSlugs).toEqual([{ eprId: "b", slug: null }]);
    expect(writes.offerings).toEqual([
      { eprId: "b", webKey: CHECKUP, webSelectable: false, eprActivated: true },
    ]);
    expect(writes.events.map((e) => [e.kind, e.eprId, e.eprSlots])).toEqual([
      ["clinic_region_changed", "a", null],
      ["clinic_removed", "b", 4],
      ["max_lead_changed", null, null],
      ["selectable_changed", "b", 4],
    ]);
  });

  it("records activation changes only against an earlier activation list", () => {
    const ctx = (fetched: Date | null) =>
      context({
        previousRun: { id: 7, maxLeadDays: 90 },
        activationFetchedAt: fetched,
        offerings: new Map([[pairKey("a", AKUT), { webSelectable: false, eprActivated: true }]]),
      });
    const activation = new Map([["a", new Map<string, Set<string>>()]]);
    const kinds = (fetched: Date | null) =>
      diffRegistry({
        ctx: ctx(fetched),
        registry: null,
        activation,
        procedureIds: new Map(),
        eprSlots: new Map(),
      }).events.map((e) => e.kind);
    expect(kinds(null)).toEqual([]);
    expect(kinds(measuredAt)).toEqual(["epr_activation_changed"]);
  });

  it("adds the procedure ids the web's slots named", () => {
    const writes = diffRegistry({
      ctx: context(),
      registry: registry([clinic("a")]),
      activation: new Map(),
      procedureIds: new Map([[pairKey("a", CHECKUP), new Set(["1", "44"])]]),
      eprSlots: new Map(),
    });
    expect(writes.procedures.map((p) => p.procedureId)).toEqual(["1", "44"]);
  });
});

describe("planPairs", () => {
  it("measures the stored registry when the web's pages failed, and activated pairs in the booking system only", () => {
    const ctx = context({
      clinics: new Map([
        ["a", { id: 1, eprId: "a", slug: "clinic-a", name: "Clinic a", city: "S", regionKey: "s" }],
      ]),
      treatments: new Map([
        [CHECKUP, { id: 1, webKey: CHECKUP, name: "Basundersökning", slug: "basundersokning" }],
        [AKUT, { id: 2, webKey: AKUT, name: "Akut", slug: "akut" }],
      ]),
      offerings: new Map([
        [pairKey("a", CHECKUP), { webSelectable: true, eprActivated: true }],
        [pairKey("a", AKUT), { webSelectable: false, eprActivated: true }],
      ]),
    });
    expect(planPairs(ctx, null).map((p) => [p.key, p.webSelectable, p.procedureIds])).toEqual([
      [pairKey("a", CHECKUP), true, ["1"]],
      [pairKey("a", AKUT), false, ["23"]],
    ]);
  });
});

describe("collect", () => {
  const clock = { now: () => measuredAt.getTime(), sleep: async () => undefined };
  const base = {
    window,
    measuredAt,
    timeZone: "Europe/Stockholm",
    clock,
    activationClinics: [],
    activationUntil: measuredAt.getTime() + 1,
    removed: [],
  };
  const both = slot("2026-11-04T08:00:00Z");
  const only = slot("2026-11-04T09:00:00Z");

  it("measures a differing pair once more and keeps the first answers if the second read fails", async () => {
    let webCalls = 0;
    const result = await collect({
      ...base,
      pairs: [pair("a")],
      sources: {
        web: {
          key: "web",
          readRegistry: async () => {
            throw new Error("unused");
          },
          readSlots: async () => {
            webCalls++;
            if (webCalls > 1) throw new SourceRequestError("oralcare_se", "http_503");
            return { kind: "slots", slots: [both] };
          },
        },
        epr: { key: "epr", readSlots: async () => [both, only], readActivation: async () => new Map() },
      },
    });
    expect(webCalls).toBe(2);
    expect(result.remeasured).toBe(1);
    expect(result.results.get(pairKey("a", CHECKUP))?.web).toMatchObject({ kind: "slots", slots: [both] });
  });

  it("asks the booking system for the procedure ids the web's slots name", async () => {
    const asked: string[] = [];
    const result = await collect({
      ...base,
      pairs: [pair("a")],
      sources: {
        web: {
          key: "web",
          readRegistry: async () => {
            throw new Error("unused");
          },
          readSlots: async () => ({ kind: "slots", slots: [slot("2026-11-04T08:00:00Z", "c1", "44")] }),
        },
        epr: {
          key: "epr",
          readSlots: async (_clinic, procedureId) => {
            asked.push(procedureId);
            return procedureId === "44" ? [slot("2026-11-04T08:00:00Z", "c1", "44")] : [];
          },
          readActivation: async () => new Map(),
        },
      },
    });
    expect(asked.sort()).toEqual(["1", "44"]);
    expect(result.pairs[0]?.procedureIds).toEqual(["1", "44"]);
    expect(result.remeasured).toBe(0);
  });

  it("skips the activation list when its time is up", async () => {
    const result = await collect({
      ...base,
      pairs: [],
      activationClinics: ["a"],
      activationUntil: measuredAt.getTime(),
      sources: {
        web: {
          key: "web",
          readRegistry: async () => registryStub(),
          readSlots: async () => ({ kind: "not-found" }),
        },
        epr: {
          key: "epr",
          readSlots: async () => [],
          readActivation: async () => {
            throw new Error("must not be called");
          },
        },
      },
    });
    expect(result).toMatchObject({ activationComplete: false, activation: new Map() });
  });

  it("saves failures as short codes, and a new format with field and types only", () => {
    expect(failure(new StopError("budget"))).toEqual({ reason: "budget" });
    expect(failure(new SourceRequestError("muntra", "page_cap"))).toEqual({ reason: "page_cap" });
    expect(failure(new SourceFormatError("Muntra", "meta", "object", "undefined"))).toEqual({
      reason: "format",
      format: { source: "Muntra", path: "meta", expected: "object", received: "undefined" },
    });
    expect(failure(new TypeError("x"))).toEqual({ reason: "error" });
  });
});

function registryStub(): Registry {
  return { treatments: [], selectable: new Map(), clinics: [], maxLeadDays: 90 };
}
