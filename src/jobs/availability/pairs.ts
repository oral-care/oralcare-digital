import type { WebClinic } from "@/lib/availability/sources/oralcare-se";

import { pairKey, type Context } from "./context";
import type { Registry } from "./sources/types";

// Which clinic and treatment pairs a measurement covers (plan 6.1): every pair
// patients can choose on the web, plus pairs that are activated in the booking
// system or were choosable before, so a pair that stops being online is still
// measured there. Pure module.

export type Pair = {
  key: string;
  eprId: string;
  webKey: string;
  clinicName: string;
  treatmentName: string;
  /** Patients can choose the clinic for the treatment on the web in this run. */
  webSelectable: boolean;
  /** Booking-system procedure ids to ask for. Web slots can add more during the run. */
  procedureIds: string[];
};

/** The key's numeric suffix is the booking-system id to start from: muntra-treatment-23 is 23 (plan 6.2). */
export function defaultProcedureId(webKey: string): string | null {
  return /-(\d+)$/.exec(webKey)?.[1] ?? null;
}

export function procedureIdsFor(ctx: Context, eprId: string, webKey: string): string[] {
  const ids = new Set(ctx.procedures.get(pairKey(eprId, webKey)));
  const fallback = defaultProcedureId(webKey);
  if (fallback) ids.add(fallback);
  return [...ids].sort();
}

/** Every clinic the web shows: the clinic list and the clinics in the booking flow. */
export function webClinics(registry: Registry): Map<string, WebClinic> {
  const clinics = new Map<string, WebClinic>();
  for (const list of registry.selectable.values()) {
    for (const clinic of list) clinics.set(clinic.eprId, clinic);
  }
  // The clinic list has the authoritative name, city and region.
  for (const clinic of registry.clinics) clinics.set(clinic.eprId, clinic);
  return clinics;
}

/**
 * The pairs to measure. Without a registry (its pages failed), the stored one
 * is used, so a broken page never stops the measurement.
 */
export function planPairs(ctx: Context, registry: Registry | null): Pair[] {
  const selectable = new Set<string>();
  if (registry) {
    for (const [webKey, clinics] of registry.selectable) {
      for (const clinic of clinics) selectable.add(pairKey(clinic.eprId, webKey));
    }
  } else {
    for (const [key, offering] of ctx.offerings) {
      const [eprId = "", webKey = ""] = key.split("|");
      const listed = ctx.clinics.get(eprId)?.slug != null && ctx.treatments.get(webKey)?.name != null;
      if (offering.webSelectable && listed) selectable.add(key);
    }
  }

  const keys = new Set(selectable);
  for (const [key, offering] of ctx.offerings) {
    if (offering.webSelectable || offering.eprActivated) keys.add(key);
  }

  const clinics = registry ? webClinics(registry) : new Map<string, WebClinic>();
  const treatments = new Map(registry?.treatments.map((t) => [t.internalKey, t.name]));
  return [...keys].sort().map((key) => {
    const [eprId = "", webKey = ""] = key.split("|");
    return {
      key,
      eprId,
      webKey,
      clinicName: clinics.get(eprId)?.name ?? ctx.clinics.get(eprId)?.name ?? eprId,
      treatmentName: treatments.get(webKey) ?? ctx.treatments.get(webKey)?.name ?? webKey,
      webSelectable: selectable.has(key),
      procedureIds: procedureIdsFor(ctx, eprId, webKey),
    };
  });
}

/**
 * Treatments that left the booking menu in this run, each with a clinic that
 * offered it, so the web can be asked whether the treatment is withdrawn (plan 6.2).
 */
export function removedTreatments(
  ctx: Context,
  registry: Registry | null,
): { webKey: string; eprId: string }[] {
  if (!registry) return [];
  const inMenu = new Set(registry.treatments.map((t) => t.internalKey));
  const removed: { webKey: string; eprId: string }[] = [];
  for (const treatment of ctx.treatments.values()) {
    if (treatment.name === null || inMenu.has(treatment.webKey)) continue;
    const offered = [...ctx.offerings].find(
      ([key, o]) => o.webSelectable && key.endsWith(`|${treatment.webKey}`),
    );
    const eprId = offered?.[0].split("|")[0];
    if (eprId) removed.push({ webKey: treatment.webKey, eprId });
  }
  return removed;
}
