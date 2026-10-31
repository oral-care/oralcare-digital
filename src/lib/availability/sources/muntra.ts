import { z } from "zod";

import { formatError } from "./oralcare-se";

// Muntra's public API as the booking system source (plan 6.2). The response is
// JSON:API with caregivers, clinics, reviews and contact details in "included".
// Only slot times, caregiver ids (used during the measurement, never stored) and
// procedure ids are kept.

const ref = z.object({ type: z.string(), id: z.union([z.string(), z.number()]).transform(String) });
const refList = z.object({ data: z.array(ref) });

const caregiverAtLocation = z.object({
  id: z.string(),
  type: z.literal("muntra_caregiver_at_location"),
  relationships: z.object({
    caregiver: z.object({ data: ref }),
    free_bookable_slots: refList.optional(),
    procedures: refList.optional(),
  }),
});

const included = z.array(
  z.object({
    type: z.string(),
    id: z.union([z.string(), z.number()]).transform(String),
    attributes: z.record(z.string(), z.unknown()).optional(),
    relationships: z.record(z.string(), z.unknown()).optional(),
  }),
);

const response = z.object({
  data: z.array(caregiverAtLocation),
  included: included.optional(),
  meta: z.object({
    pagination: z.object({ current_page: z.number().int(), total_pages: z.number().int() }),
  }),
});

export type MuntraPage = {
  caregivers: {
    caregiverId: string;
    slotStarts: string[];
    procedureIds: string[];
  }[];
  page: number;
  totalPages: number;
};

const slotAttributes = z.object({ dtstart: z.string().min(1) });
const procedureRelationship = z.object({ procedure: z.object({ data: ref }) });

export function readMuntraPage(json: unknown): MuntraPage {
  const parsed = response.safeParse(json);
  if (!parsed.success) throw formatError("Muntra", parsed.error);
  const { data, meta } = parsed.data;

  const slots = new Map<string, string>();
  const procedureOf = new Map<string, string>();
  for (const item of parsed.data.included ?? []) {
    if (item.type === "muntra_free_bookable_slot") {
      const attributes = slotAttributes.safeParse(item.attributes);
      if (!attributes.success) throw formatError("Muntra slot", attributes.error);
      slots.set(item.id, attributes.data.dtstart);
    } else if (item.type === "muntra_caregiver_procedure_at_location") {
      const relationship = procedureRelationship.safeParse(item.relationships);
      if (!relationship.success) throw formatError("Muntra procedure", relationship.error);
      procedureOf.set(item.id, relationship.data.procedure.data.id);
    }
    // Every other type (caregiver, clinic, reviews, images) is ignored.
  }

  return {
    page: meta.pagination.current_page,
    totalPages: meta.pagination.total_pages,
    caregivers: data.map((entry) => ({
      caregiverId: entry.relationships.caregiver.data.id,
      slotStarts: (entry.relationships.free_bookable_slots?.data ?? []).flatMap((r) => {
        const start = slots.get(r.id);
        return start ? [start] : [];
      }),
      procedureIds: (entry.relationships.procedures?.data ?? []).flatMap((r) => {
        const procedure = procedureOf.get(r.id);
        return procedure ? [procedure] : [];
      }),
    })),
  };
}

/**
 * Which caregivers at a clinic have each procedure open for online booking. Ids,
 * so a treatment with several procedures counts each caregiver once.
 */
export function activatedProcedures(pages: MuntraPage[]): Map<string, Set<string>> {
  const caregivers = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const caregiver of page.caregivers) {
      for (const procedureId of caregiver.procedureIds) {
        caregivers.set(procedureId, (caregivers.get(procedureId) ?? new Set()).add(caregiver.caregiverId));
      }
    }
  }
  return caregivers;
}
