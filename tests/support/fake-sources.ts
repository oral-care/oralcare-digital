import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  EprSource,
  Registry,
  WebBookingSource,
  WebSlotsResult,
} from "@/jobs/availability/sources/types";
import type { Clock } from "@/jobs/runtime/http";
import type { Slot } from "@/lib/availability/compare";
import { activatedProcedures, readMuntraPage } from "@/lib/availability/sources/muntra";
import {
  readBookingPage,
  readClinicList,
  readClinicsForTreatment,
  readMaxLeadDays,
  readSlots,
} from "@/lib/availability/sources/oralcare-se";
import type { MeasurementWindow } from "@/lib/availability/window";

// Sources for the integration tests, built from the recorded answers in
// tests/fixtures with the real parsers. A test changes what they answer to
// play out a scenario. They never reach the network.

const fixture = (...parts: string[]) => readFileSync(path.join("tests/fixtures", ...parts), "utf8");

/** The clinic and treatment the recorded slots are for. */
export const SLOT_CLINIC = "2528";
export const CHECKUP = "muntra-checkup-1";
export const WHITENING = "muntra-treatment-9";

/** The booking menu with a few clinics per treatment, so a run stays small. */
export function fixtureRegistry(): Registry {
  const menu = readBookingPage(fixture("oralcare-se", "boka.html"));
  const clinics = readClinicList(fixture("oralcare-se", "kliniker.html"));
  const slotClinic = clinics.find((c) => c.eprId === SLOT_CLINIC);
  if (!slotClinic) throw new Error("The recorded clinic is missing in kliniker.html");
  const checkup = [slotClinic, ...menu.clinics.filter((c) => c.eprId !== SLOT_CLINIC).slice(0, 2)];
  const whitening = readClinicsForTreatment(fixture("oralcare-se", "boka-tandblekning.html"), "tandblekning");
  return {
    treatments: menu.treatments,
    selectable: new Map(
      menu.treatments.map((t) => [
        t.internalKey,
        t.internalKey === CHECKUP ? checkup : t.internalKey === WHITENING ? whitening : [],
      ]),
    ),
    clinics,
    maxLeadDays: readMaxLeadDays(fixture("oralcare-se", "boka-tid.html")),
  };
}

export function fixtureWebSlots(): Slot[] {
  return readSlots(JSON.parse(fixture("oralcare-se", "get-slots.json"))).map((s) => ({
    start: new Date(s.start),
    caregiverId: s.caregiverId,
    procedureId: s.treatmentEprId,
  }));
}

/** The recorded booking-system slots, for procedure 1 at the recorded clinic. */
export function fixtureEprSlots(): Slot[] {
  const page = readMuntraPage(JSON.parse(fixture("muntra", "slots.json")));
  return page.caregivers.flatMap((c) =>
    c.slotStarts.map((start) => ({ start: new Date(start), caregiverId: c.caregiverId, procedureId: "1" })),
  );
}

export function fixtureActivation(): Map<string, Set<string>> {
  return activatedProcedures([readMuntraPage(JSON.parse(fixture("muntra", "activation.json")))]);
}

export class FakeWeb implements WebBookingSource {
  readonly key = "oralcare_se";
  registry: Registry | Error = fixtureRegistry();
  /** Answers per `${clinic}|${webKey}`. A missing entry is no slots. */
  slots = new Map<string, Slot[] | "not-found" | Error>();
  calls: string[] = [];

  async readRegistry(): Promise<Registry> {
    if (this.registry instanceof Error) throw this.registry;
    return this.registry;
  }

  async readSlots(clinicId: string, treatmentKey: string): Promise<WebSlotsResult> {
    this.calls.push(`${clinicId}|${treatmentKey}`);
    const answer = this.slots.get(`${clinicId}|${treatmentKey}`) ?? [];
    if (answer === "not-found") return { kind: "not-found" };
    if (answer instanceof Error) throw answer;
    return { kind: "slots", slots: answer };
  }
}

export class FakeEpr implements EprSource {
  readonly key = "muntra";
  /** Slots per `${clinic}|${procedureId}`, cut to the window like the API does. */
  slots = new Map<string, Slot[] | Error>();
  activation = new Map<string, Map<string, Set<string>>>();
  activationCalls = 0;

  async readSlots(clinicId: string, procedureId: string, window: MeasurementWindow): Promise<Slot[]> {
    const answer = this.slots.get(`${clinicId}|${procedureId}`) ?? [];
    if (answer instanceof Error) throw answer;
    return answer.filter((s) => s.start >= window.from && s.start < window.to);
  }

  async readActivation(clinicId: string): Promise<Map<string, Set<string>>> {
    this.activationCalls++;
    return this.activation.get(clinicId) ?? new Map();
  }
}

/** A clock that starts at the test's "now" and runs at real speed. */
export function clockAt(now: Date): Clock {
  const offset = now.getTime() - Date.now();
  return { now: () => Date.now() + offset, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}
