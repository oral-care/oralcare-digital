import { compareSlots } from "@/lib/availability/compare";
import { SourceFormatError } from "@/lib/availability/sources/oralcare-se";
import type { MeasurementWindow } from "@/lib/availability/window";

import { SourceRequestError, StopError, type Clock } from "../runtime/http";
import type { FormatProblem, PairResult, SourceResult } from "./evaluate";
import type { Pair } from "./pairs";
import type { Activation } from "./registry";
import type { EprSource, WebBookingSource } from "./sources/types";

// Steps 3 to 6 of a measurement (plan 6.1): the web and then the booking system
// for every pair, a second look at pairs where they differ, the check of
// treatments that left the booking menu, and the booking system's list of
// activated treatments when it is due and there is time.

export type Sources = { web: WebBookingSource; epr: EprSource };

export type CollectInput = {
  pairs: Pair[];
  sources: Sources;
  window: MeasurementWindow;
  /** The run's start: the web is asked from here and clamps to its own lead time. */
  measuredAt: Date;
  timeZone: string;
  clock: Clock;
  /** Clinics whose activation list is due in this run. Empty when it isn't. */
  activationClinics: string[];
  /** No activation list is started after this time (plan 7). */
  activationUntil: number;
  /** Treatments that left the booking menu, each with a clinic that offered it. */
  removed: { webKey: string; eprId: string }[];
};

export type Collected = {
  /** The pairs with the procedure ids the web's slots added. */
  pairs: Pair[];
  results: Map<string, PairResult>;
  activation: Activation;
  /** True when every due clinic's list was read. */
  activationComplete: boolean;
  /** Web keys of treatments the web answered 404 for. */
  withdrawn: string[];
  remeasured: number;
  stopped: "budget" | "failures" | null;
  /** New formats outside the pairs, from the activation lists. */
  formatProblems: FormatProblem[];
};

/** What a failed read is saved as: a short code, and the field and types for a new format. */
export function failure(error: unknown): { reason: string; format?: FormatProblem } {
  if (error instanceof StopError) return { reason: error.reason };
  if (error instanceof SourceRequestError) return { reason: error.code };
  if (error instanceof SourceFormatError) {
    const { source, path, expected, received } = error;
    return { reason: "format", format: { source, path, expected, received } };
  }
  if (error instanceof SyntaxError) {
    return {
      reason: "format",
      format: { source: "response", path: "(root)", expected: "json", received: "other" },
    };
  }
  return { reason: "error" };
}

export async function collect(input: CollectInput): Promise<Collected> {
  const { sources, window, measuredAt, clock } = input;
  const at = () => new Date(clock.now());
  const stops = new Set<string>();
  const failed = (error: unknown, requestedAt: Date | null): SourceResult => {
    const { reason, format } = failure(error);
    if (reason === "budget" || reason === "failures") stops.add(reason);
    return {
      kind: "failed",
      reason,
      ...(format && { format }),
      requestedAt,
      respondedAt: requestedAt && at(),
    };
  };

  const readWeb = async (pair: Pair): Promise<SourceResult> => {
    const requestedAt = at();
    try {
      const result = await sources.web.readSlots(pair.eprId, pair.webKey, measuredAt, window.to);
      const respondedAt = at();
      return result.kind === "not-found"
        ? { kind: "not-found", requestedAt, respondedAt }
        : { kind: "slots", slots: result.slots, requestedAt, respondedAt };
    } catch (error) {
      return failed(error, requestedAt);
    }
  };

  const readEpr = async (pair: Pair, procedureIds: string[]): Promise<SourceResult> => {
    if (procedureIds.length === 0)
      return { kind: "failed", reason: "no_procedure_id", requestedAt: null, respondedAt: null };
    const requestedAt = at();
    try {
      const parts = await Promise.all(
        procedureIds.map((id) => sources.epr.readSlots(pair.eprId, id, window)),
      );
      return { kind: "slots", slots: parts.flat(), requestedAt, respondedAt: at() };
    } catch (error) {
      return failed(error, requestedAt);
    }
  };

  // The web first, then the booking system with every procedure id the web's
  // slots name, so both are asked for the same thing (plan 6.2).
  const measure = async (pair: Pair) => {
    const web = pair.webSelectable ? await readWeb(pair) : null;
    const seen = web?.kind === "slots" ? web.slots.map((s) => s.procedureId) : [];
    const procedureIds = [...new Set([...pair.procedureIds, ...seen])].sort();
    const epr = await readEpr(pair, procedureIds);
    return { pair: { ...pair, procedureIds }, result: { web, epr } };
  };

  const measured = await Promise.all(input.pairs.map(measure));
  const results = new Map(measured.map((m) => [m.pair.key, m.result]));
  const pairs = measured.map((m) => m.pair);

  // The web sometimes answers with fewer slots when its own call to the booking
  // system fails, so differing pairs are measured once more (plan 6.1).
  const differing = pairs.filter((pair) => {
    const { web, epr } = results.get(pair.key)!;
    if (web?.kind !== "slots" || epr.kind !== "slots") return false;
    const difference = compareSlots(web.slots, epr.slots, window, measuredAt, input.timeZone);
    return difference.slotsNotOnline + difference.earlyOnly > 0;
  });
  await Promise.all(
    differing.map(async (pair) => {
      const again = await measure(pair);
      if (again.result.web?.kind === "slots" && again.result.epr.kind === "slots") {
        results.set(pair.key, again.result);
      }
    }),
  );

  const withdrawn: string[] = [];
  await Promise.all(
    input.removed.map(async ({ webKey, eprId }) => {
      const answer = await sources.web.readSlots(eprId, webKey, measuredAt, window.to).catch(() => null);
      if (answer?.kind === "not-found") withdrawn.push(webKey);
    }),
  );

  const activation: Activation = new Map();
  const formatProblems: FormatProblem[] = [];
  let activationComplete = false;
  if (input.activationClinics.length > 0 && clock.now() < input.activationUntil) {
    const lists = await Promise.all(
      input.activationClinics.map(async (eprId) => {
        try {
          return [eprId, await sources.epr.readActivation(eprId)] as const;
        } catch (error) {
          const result = failed(error, null);
          if (result.kind === "failed" && result.format) formatProblems.push(result.format);
          return null;
        }
      }),
    );
    for (const list of lists) if (list) activation.set(list[0], list[1]);
    activationComplete = activation.size === input.activationClinics.length;
  }

  return {
    pairs,
    results,
    activation,
    activationComplete,
    withdrawn: withdrawn.sort(),
    remeasured: differing.length,
    stopped: stops.has("failures") ? "failures" : stops.has("budget") ? "budget" : null,
    formatProblems,
  };
}
