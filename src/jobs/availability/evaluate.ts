import { compareSlots, dayIndex, summarize, type Slot } from "@/lib/availability/compare";
import { availabilityStatus, waitingTimeStatus } from "@/lib/availability/statuses";
import type { MeasurementWindow } from "@/lib/availability/window";

import type { AlertDraft } from "@/lib/alerts/types";

import type { Context } from "./context";
import type { Pair } from "./pairs";
import { activatedCaregivers, type Activation } from "./registry";

// From the collected answers to the rows a measurement saves (plan 5, 6.3, 6.4
// and 8.1): one measurement per pair and source, the comparison, the incident
// check, the window check, coverage, alerts and, at the day's point, the daily
// value. Pure module.

export type FormatProblem = { source: string; path: string; expected: string; received: string };

export type SourceResult =
  | { kind: "slots"; slots: Slot[]; requestedAt: Date; respondedAt: Date }
  | { kind: "not-found"; requestedAt: Date; respondedAt: Date }
  | {
      kind: "failed";
      reason: string;
      format?: FormatProblem;
      requestedAt: Date | null;
      respondedAt: Date | null;
    };

/** The web result is null when patients can't choose the clinic for the treatment. */
export type PairResult = { web: SourceResult | null; epr: SourceResult };

export type MeasurementStatus = "measured" | "not_offered" | "could_not_be_measured";
export type Source = "web" | "epr";

export type MeasurementRow = {
  pair: Pair;
  source: Source;
  status: MeasurementStatus;
  reason: string | null;
  slots7: number | null;
  slots14: number | null;
  slots30: number | null;
  firstFreeAt: Date | null;
  firstFreeDays: number | null;
  caregiversActivated: number | null;
  windowStart: Date;
  windowEnd: Date;
  requestedAt: Date | null;
  respondedAt: Date | null;
  /** Start times as minutes from the run's window start (job_run.window_start). */
  startMinutes: number[] | null;
};

export type ComparisonRow = {
  pair: Pair;
  webSlots: number | null;
  eprSlots: number | null;
  slotsNotOnline: number | null;
};

export type DailyRow = {
  pair: Pair;
  source: Source;
  status: MeasurementStatus;
  slots14: number | null;
  firstFreeDays: number | null;
  availability: "good" | "low" | null;
  waitingTime: "short" | "long" | null;
  thresholdVersionId: number;
  startMinutes: number[];
};

export type Evaluation = {
  measurements: MeasurementRow[];
  comparisons: ComparisonRow[];
  incident: { shareMissing: number } | null;
  coverage: { measured: number; expected: number };
  alerts: AlertDraft[];
  /** Booking-system slots within 14 days per pair, for the change events. */
  eprSlots14: Map<string, number>;
};

export type EvaluateInput = {
  ctx: Context;
  pairs: Pair[];
  results: Map<string, PairResult>;
  activation: Activation;
  window: MeasurementWindow;
  /** The run's own start: day 0 and the start the web is asked from. */
  measuredAt: Date;
  timeZone: string;
  /** The reason the collection stopped early, if it did. */
  stopped: "budget" | "failures" | null;
  /** Treatments the web answered 404 for and that also left the booking menu. */
  withdrawn: { webKey: string; name: string }[];
  /** Format problems outside the pairs, such as the registry pages. */
  otherFormatProblems: FormatProblem[];
  maxLeadChange: { before: number; after: number } | null;
};

const MINUTE = 60_000;
const ANOMALY_MIN_CLINICS = 3;
export const COVERAGE_ALERT_BELOW = 0.95;

export function evaluate(input: EvaluateInput): Evaluation {
  const { ctx, pairs, results, activation, window, measuredAt, timeZone } = input;
  const minutes = (slots: Slot[]) =>
    slots.map((s) => Math.round((s.start.getTime() - window.from.getTime()) / MINUTE));
  const inWindow14 = (slots: Slot[]) =>
    slots.filter(
      (s) => s.start >= window.from && s.start < window.to && dayIndex(measuredAt, s.start, timeZone) <= 13,
    );
  const alerts: AlertDraft[] = [];
  const formats = new Map<string, FormatProblem & { count: number }>();
  const noteFormat = (problem: FormatProblem | undefined) => {
    if (!problem) return;
    const key = `${problem.source}:${problem.path}`;
    const seen = formats.get(key);
    formats.set(key, { ...problem, count: (seen?.count ?? 0) + 1 });
  };
  input.otherFormatProblems.forEach(noteFormat);

  type Working = {
    pair: Pair;
    web: MeasurementRow;
    epr: MeasurementRow;
    webSlots: Slot[] | null;
    eprSlots: Slot[] | null;
    comparison: ReturnType<typeof compareSlots> | null;
  };
  const working: Working[] = [];

  for (const pair of pairs) {
    const result = results.get(pair.key);
    if (!result) continue;
    const caregivers = activatedCaregivers(activation, pair.eprId, pair.procedureIds);
    const stored = ctx.offerings.get(pair.key);
    const activated = caregivers !== null ? caregivers > 0 : stored?.eprActivated;

    const web = toRow(
      pair,
      "web",
      result.web,
      { start: measuredAt, end: window.to },
      measuredAt,
      timeZone,
      minutes,
      null,
    );
    const webResult = result.web;
    const webSlots = webResult?.kind === "slots" ? webResult.slots : null;
    if (webResult?.kind === "failed") noteFormat(webResult.format);
    if (webResult?.kind === "failed" && webResult.reason === "http_400") {
      alerts.push(collectorError(pair, "rejected"));
    }
    // The web is asked from the run's start and applies its own lead time, so
    // an earlier slot means the collector or the web is wrong (plan 6.3).
    if (webResult?.kind === "slots" && webResult.slots.some((s) => s.start < webResult.requestedAt)) {
      alerts.push(collectorError(pair, "slot_before_window"));
    }

    const epr = toRow(
      pair,
      "epr",
      result.epr,
      { start: window.from, end: window.to },
      measuredAt,
      timeZone,
      minutes,
      caregivers,
    );
    if (result.epr.kind === "failed") noteFormat(result.epr.format);
    const eprSlots = result.epr.kind === "slots" ? result.epr.slots : null;
    // No slots and nobody has the treatment activated: not offered, never 0 (plan 6.4).
    if (epr.status === "measured" && eprSlots?.length === 0 && activated === false) {
      Object.assign(epr, {
        status: "not_offered",
        slots7: null,
        slots14: null,
        slots30: null,
        startMinutes: null,
      });
    }

    const comparison =
      eprSlots && (webSlots || web.status === "not_offered")
        ? compareSlots(webSlots ?? [], eprSlots, window, measuredAt, timeZone)
        : null;
    working.push({ pair, web, epr, webSlots, eprSlots, comparison });
  }

  // Booking-system-only slots in the window's first 2 hours on at least 3
  // clinics mean the window is off, not that slots are missing online (plan 6.3).
  const earlyClinics = new Set(
    working.filter((w) => (w.comparison?.earlyOnly ?? 0) > 0).map((w) => w.pair.eprId),
  );
  const anomaly = earlyClinics.size >= ANOMALY_MIN_CLINICS;
  if (anomaly) alerts.push({ type: "window_anomaly", subject: "-", payload: { clinics: earlyClinics.size } });

  // Incident: the web shows nothing for a large share of the pairs where the
  // booking system has slots (plan 6.4).
  const withEpr = working.filter(
    (w) => w.web.status === "measured" && w.eprSlots && inWindow14(w.eprSlots).length > 0,
  );
  const missing = withEpr.filter((w) => inWindow14(w.webSlots ?? []).length === 0).length;
  const shareMissing = withEpr.length > 0 ? missing / withEpr.length : 0;
  const incident = withEpr.length > 0 && shareMissing >= ctx.incidentThreshold ? { shareMissing } : null;
  if (incident) {
    alerts.push({ type: "incident", subject: "-", payload: { percent: Math.round(shareMissing * 100) } });
    for (const w of working) {
      if (w.web.status !== "measured") continue;
      Object.assign(w.web, {
        status: "could_not_be_measured",
        reason: "incident",
        slots7: null,
        slots14: null,
        slots30: null,
        firstFreeAt: null,
        firstFreeDays: null,
        startMinutes: null,
      });
      w.webSlots = null;
      w.comparison = null;
    }
  }

  const comparisons: ComparisonRow[] = [];
  const eprSlots14 = new Map<string, number>();
  for (const w of working) {
    const eprIn14 = w.eprSlots ? inWindow14(w.eprSlots).length : w.epr.status === "not_offered" ? 0 : null;
    if (eprIn14 !== null) eprSlots14.set(w.pair.key, eprIn14);
    const slotsNotOnline =
      w.epr.status === "not_offered"
        ? 0
        : w.comparison
          ? w.comparison.slotsNotOnline + (anomaly ? 0 : w.comparison.earlyOnly)
          : null;
    comparisons.push({
      pair: w.pair,
      webSlots: w.webSlots ? inWindow14(w.webSlots).length : null,
      eprSlots: eprIn14,
      slotsNotOnline,
    });

    const previous = ctx.previousPairs.get(w.pair.key);
    const webOnlineNow =
      w.web.status === "measured" ? (w.web.slots14 ?? 0) > 0 : w.web.status === "not_offered" ? false : null;
    if (previous?.webOnline === true && webOnlineNow === false && (slotsNotOnline ?? 0) > 0) {
      alerts.push({
        type: "treatment_not_online",
        subject: w.pair.key,
        payload: { clinic: w.pair.clinicName, treatment: w.pair.treatmentName, slots: slotsNotOnline },
      });
    } else if ((slotsNotOnline ?? 0) > 0 && (previous?.slotsNotOnline ?? 0) > 0) {
      alerts.push({
        type: "slots_not_online",
        subject: w.pair.key,
        payload: { clinic: w.pair.clinicName, treatment: w.pair.treatmentName, slots: slotsNotOnline },
      });
    }
  }

  for (const treatment of input.withdrawn) {
    alerts.push({
      type: "treatment_withdrawn",
      subject: treatment.webKey,
      payload: { treatment: treatment.name },
    });
  }
  if (input.maxLeadChange) {
    alerts.push({ type: "max_lead_changed", subject: "-", payload: { ...input.maxLeadChange } });
  }
  for (const [key, problem] of formats) {
    alerts.push({ type: "format", subject: key, payload: { ...problem } });
  }
  if (input.stopped)
    alerts.push({ type: "stopped_early", subject: input.stopped, payload: { reason: input.stopped } });

  const measurements = working.flatMap((w) => [w.web, w.epr]);
  const expected = measurements.filter((m) => m.status !== "not_offered").length;
  const measured = measurements.filter((m) => m.status === "measured").length;
  if (expected > 0 && measured / expected < COVERAGE_ALERT_BELOW) {
    alerts.push({
      type: "low_coverage",
      subject: "-",
      payload: { percent: Math.floor((measured / expected) * 100), measured, expected },
    });
  }

  return { measurements, comparisons, incident, coverage: { measured, expected }, alerts, eprSlots14 };
}

function toRow(
  pair: Pair,
  source: Source,
  result: SourceResult | null,
  window: { start: Date; end: Date },
  measuredAt: Date,
  timeZone: string,
  minutes: (slots: Slot[]) => number[],
  caregivers: number | null,
): MeasurementRow {
  const base = {
    pair,
    source,
    slots7: null,
    slots14: null,
    slots30: null,
    firstFreeAt: null,
    firstFreeDays: null,
    caregiversActivated: source === "epr" ? caregivers : null,
    windowStart: window.start,
    windowEnd: window.end,
    requestedAt: result && "requestedAt" in result ? result.requestedAt : null,
    respondedAt: result && "respondedAt" in result ? result.respondedAt : null,
    startMinutes: null,
  };
  if (result === null) return { ...base, status: "not_offered", reason: null };
  if (result.kind === "not-found") return { ...base, status: "could_not_be_measured", reason: "http_404" };
  if (result.kind === "failed") return { ...base, status: "could_not_be_measured", reason: result.reason };
  const sorted = [...result.slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    ...base,
    ...summarize(sorted, measuredAt, timeZone),
    status: "measured",
    reason: null,
    startMinutes: minutes(sorted),
  };
}

function collectorError(pair: Pair, variant: "rejected" | "slot_before_window"): AlertDraft {
  return {
    type: "collector_error",
    subject: `${variant}:${pair.key}`,
    payload: { variant, clinic: pair.clinicName, treatment: pair.treatmentName },
  };
}

/** The daily value from this run's measurements, with the thresholds that apply today (plan 5.2 and 5.5). */
export function dailyRows(ctx: Context, measurements: MeasurementRow[]): DailyRow[] {
  return measurements.map((m) => {
    const thresholds = ctx.thresholds.get(m.pair.webKey) ?? ctx.thresholds.get(null);
    if (!thresholds) throw new Error("No default status thresholds for the market");
    const measured = m.status === "measured";
    return {
      pair: m.pair,
      source: m.source,
      status: m.status,
      slots14: m.slots14,
      firstFreeDays: m.firstFreeDays,
      availability: measured ? availabilityStatus(m.slots14 ?? 0, thresholds) : null,
      waitingTime: measured ? waitingTimeStatus(m.firstFreeDays, thresholds) : null,
      thresholdVersionId: thresholds.id,
      startMinutes: m.startMinutes ?? [],
    };
  });
}
