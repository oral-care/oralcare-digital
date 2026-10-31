import { z } from "zod";

import { findObjects, parseFlight, resolveReference } from "./flight";

// oralcare.se as a web source (plan 6.2). The schemas keep only the fields that
// are used. Caregivers, contact details, addresses and reviews are dropped here
// and never reach the database, the logs or the alerts (plan 6.6).

export class SourceFormatError extends Error {
  constructor(
    readonly source: string,
    readonly path: string,
    readonly expected: string,
    readonly received: string,
  ) {
    super(`${source}: ${path} expected ${expected}, received ${received}`);
    this.name = "SourceFormatError";
  }
}

/** Turns a zod failure into the path and types only, never the values (plan 8.1). */
export function formatError(source: string, error: z.ZodError): SourceFormatError {
  const issue = error.issues[0];
  const path = issue?.path.join(".") || "(root)";
  const expected = issue && "expected" in issue ? String(issue.expected) : (issue?.code ?? "valid value");
  const received = issue?.code === "invalid_type" ? describeReceived(issue) : "invalid";
  return new SourceFormatError(source, path, expected, received);
}

function describeReceived(issue: { message: string }): string {
  const match = /received (\w+)/.exec(issue.message);
  return match?.[1] ?? "other";
}

const treatmentOption = z.object({
  internalKey: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
});
export type WebTreatment = z.infer<typeof treatmentOption>;

const clinic = z.object({
  eprId: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(1),
  city: z.string().min(1),
  slug: z.string().min(1),
  regionInternalKey: z.string().min(1),
  regionName: z.string().min(1),
});
export type WebClinic = z.infer<typeof clinic>;

function parseOrThrow<T>(source: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw formatError(source, result.error);
  return result.data;
}

/** The booking menu on /boka or /boka?treatment=<slug>: its treatments and the one shown. */
export function readBookingPage(html: string): {
  treatments: WebTreatment[];
  active: WebTreatment;
  clinics: WebClinic[];
} {
  const lines = parseFlight(html);
  const menus = findObjects(lines, (o) => Array.isArray(o.options) && "active" in o);
  if (menus.length !== 1)
    throw new SourceFormatError("oralcare.se /boka", "options", "one menu", String(menus.length));
  const menu = menus[0]!;
  const treatments = parseOrThrow("oralcare.se /boka", z.array(treatmentOption).min(1), menu.options);
  const active = parseOrThrow("oralcare.se /boka", treatmentOption, resolveReference(lines, menu.active));
  return { treatments, active, clinics: readClinics(lines, "oralcare.se /boka") };
}

/** The clinics on /boka?treatment=<slug>. The read fails if the page shows another treatment. */
export function readClinicsForTreatment(html: string, slug: string): WebClinic[] {
  const page = readBookingPage(html);
  if (page.active.slug !== slug) {
    throw new SourceFormatError("oralcare.se /boka?treatment", "active.slug", slug, "another treatment");
  }
  return page.clinics;
}

/** Every clinic on /kliniker, with name, city and region. */
export function readClinicList(html: string): WebClinic[] {
  const clinics = readClinics(parseFlight(html), "oralcare.se /kliniker");
  if (clinics.length === 0)
    throw new SourceFormatError("oralcare.se /kliniker", "clinics", "at least one", "0");
  return clinics;
}

/** How many days ahead patients can book, from /boka/tid?clinic=<slug>. */
export function readMaxLeadDays(html: string): number {
  const found = findObjects(parseFlight(html), (o) => "maxLeadDays" in o);
  const values = [...new Set(found.map((o) => o.maxLeadDays))];
  return parseOrThrow("oralcare.se /boka/tid", z.tuple([z.number().int().min(1).max(366)]), values)[0];
}

function readClinics(lines: ReturnType<typeof parseFlight>, source: string): WebClinic[] {
  const found = findObjects(lines, (o) => "eprId" in o && "regionInternalKey" in o);
  const clinics = found.map((o) => parseOrThrow(source, clinic, o));
  // The same clinic can appear in several places on a page.
  return [...new Map(clinics.map((c) => [c.eprId, c])).values()];
}

const webSlot = z.object({
  start: z.string().min(1),
  treatmentEprId: z.union([z.string(), z.number()]).transform(String),
  caregiverId: z.union([z.string(), z.number()]).transform(String),
  clinicId: z.union([z.string(), z.number()]).transform(String),
});
export type WebSlot = z.infer<typeof webSlot>;

/** The answer from GET /api/bookings/getSlots. The caregiver object is dropped. */
export function readSlots(json: unknown): WebSlot[] {
  return parseOrThrow("oralcare.se getSlots", z.object({ slots: z.array(webSlot) }), json).slots;
}
