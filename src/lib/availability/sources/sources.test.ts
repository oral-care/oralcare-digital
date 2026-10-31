import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { activatedProcedures, readMuntraPage } from "./muntra";
import {
  readBookingPage,
  readClinicList,
  readClinicsForTreatment,
  readMaxLeadDays,
  readSlots,
  SourceFormatError,
} from "./oralcare-se";

// Recorded, sanitized answers from 2026-10-31 (tests/fixtures). The fixtures
// carry a fake caregiver ("Test Person"), a fake review and fake contact
// details, so the tests can prove they never come through.
const fixture = (...parts: string[]) => readFileSync(path.join("tests/fixtures", ...parts), "utf8");
const json = (...parts: string[]) => JSON.parse(fixture(...parts)) as unknown;

describe("oralcare.se pages", () => {
  it("reads the booking menu and the treatment it shows", () => {
    const page = readBookingPage(fixture("oralcare-se", "boka.html"));
    expect(page.treatments.map((t) => t.internalKey)).toContain("muntra-treatment-23");
    expect(page.treatments).toHaveLength(7);
    expect(page.active.internalKey).toBe("muntra-checkup-1");
    expect(page.clinics.length).toBeGreaterThan(20);
  });

  it("reads the clinics for a treatment and fails when the page shows another one", () => {
    const html = fixture("oralcare-se", "boka-tandblekning.html");
    expect(readClinicsForTreatment(html, "tandblekning").map((c) => c.eprId)).toHaveLength(2);
    expect(() => readClinicsForTreatment(html, "akut-tandvard")).toThrow(SourceFormatError);
  });

  it("reads every clinic with region, and nothing about caregivers or contact", () => {
    const clinics = readClinicList(fixture("oralcare-se", "kliniker.html"));
    expect(clinics).toHaveLength(30);
    expect(Object.keys(clinics[0]!).sort()).toEqual([
      "city",
      "eprId",
      "name",
      "regionInternalKey",
      "regionName",
      "slug",
    ]);
    expect(JSON.stringify(clinics)).not.toMatch(/Test|Person|\+46/);
  });

  it("reads how far ahead patients can book", () => {
    expect(readMaxLeadDays(fixture("oralcare-se", "boka-tid.html"))).toBe(90);
  });

  it("reads slots and drops the caregiver object", () => {
    const slots = readSlots(json("oralcare-se", "get-slots.json"));
    expect(slots).toHaveLength(66);
    expect(Object.keys(slots[0]!).sort()).toEqual(["caregiverId", "clinicId", "start", "treatmentEprId"]);
    expect(JSON.stringify(slots)).not.toMatch(/Person|Tandläkare/);
  });

  it("names the field and types when the format changes, never the values", () => {
    try {
      readSlots({ slots: [{ start: 5, treatmentEprId: "1", caregiverId: "2", clinicId: "3" }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SourceFormatError);
      expect((error as SourceFormatError).path).toBe("slots.0.start");
      expect((error as SourceFormatError).expected).toBe("string");
      expect((error as SourceFormatError).message).not.toContain("5");
    }
  });

  it("ignores new fields", () => {
    expect(() => readSlots({ slots: [], newField: { anything: true } })).not.toThrow();
  });
});

describe("Muntra", () => {
  it("reads slot starts per caregiver and drops reviews and contact details", () => {
    const page = readMuntraPage(json("muntra", "slots.json"));
    expect(page.caregivers.flatMap((c) => c.slotStarts)).toHaveLength(66);
    expect(JSON.stringify(page)).not.toMatch(/review|Person|clinic@|\+46/);
    expect(page).toMatchObject({ page: 1, totalPages: 1 });
  });

  it("lists caregivers per activated procedure, each caregiver once", () => {
    const page = readMuntraPage(json("muntra", "activation.json"));
    const caregivers = activatedProcedures([page, page]);
    expect(caregivers.get("1")?.size).toBeGreaterThan(0);
    expect([...caregivers.values()].every((ids) => ids.size >= 1)).toBe(true);
    const once = activatedProcedures([page]);
    expect([...caregivers].map(([id, ids]) => [id, ids.size])).toEqual(
      [...once].map(([id, ids]) => [id, ids.size]),
    );
  });
});
