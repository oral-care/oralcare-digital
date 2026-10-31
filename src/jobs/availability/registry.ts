import { pairKey, type Context } from "./context";
import { defaultProcedureId, webClinics } from "./pairs";
import type { Registry } from "./sources/types";

// What changed in the offering since the stored registry (plan 6.5), as rows to
// write and change events. Facts only, without assessment. Nothing is removed:
// a validity period is ended and, when something replaces it, a new one starts.
// Pure module; persist.ts writes the result.

export type ChangeKind =
  | "treatment_added"
  | "treatment_removed"
  | "treatment_renamed"
  | "clinic_added"
  | "clinic_removed"
  | "clinic_region_changed"
  | "selectable_changed"
  | "epr_activation_changed"
  | "max_lead_changed";

export type ChangeEvent = {
  kind: ChangeKind;
  eprId: string | null;
  webKey: string | null;
  before: unknown;
  after: unknown;
  /** Booking-system slots within 14 days at the time, for the pair, clinic or treatment. */
  eprSlots: number | null;
};

export type RegistryWrites = {
  regions: { key: string; name: string }[];
  newClinics: { eprId: string; slug: string; name: string; city: string; regionKey: string }[];
  /** A new slug, or null when the clinic is no longer listed on the web. */
  clinicSlugs: { eprId: string; slug: string | null }[];
  clinicNames: { eprId: string; name: string; city: string }[];
  clinicRegions: { eprId: string; regionKey: string }[];
  newTreatments: { webKey: string; name: string; slug: string }[];
  /** A new name and slug, or null when the treatment left the booking menu. */
  treatmentNames: { webKey: string; name: string | null; slug: string | null }[];
  /** Replaces the pair's current offering. Both false ends it without a new one. */
  offerings: { eprId: string; webKey: string; webSelectable: boolean; eprActivated: boolean }[];
  procedures: { eprId: string; webKey: string; procedureId: string }[];
  events: ChangeEvent[];
};

/** Caregiver ids per procedure, per clinic, for the clinics whose list was read in this run. */
export type Activation = Map<string, Map<string, Set<string>>>;

export function activatedCaregivers(activation: Activation, eprId: string, procedureIds: Iterable<string>) {
  const byProcedure = activation.get(eprId);
  if (!byProcedure) return null;
  const caregivers = new Set<string>();
  for (const id of procedureIds) for (const caregiver of byProcedure.get(id) ?? []) caregivers.add(caregiver);
  return caregivers.size;
}

export type RegistryInput = {
  ctx: Context;
  /** Null when a registry page failed: then nothing from the web is changed. */
  registry: Registry | null;
  activation: Activation;
  /** Every procedure id used per pair in this run, including those seen in web slots. */
  procedureIds: Map<string, Set<string>>;
  /** Booking-system slots within 14 days per pair, where they were measured. */
  eprSlots: Map<string, number>;
};

export function diffRegistry({
  ctx,
  registry,
  activation,
  procedureIds,
  eprSlots,
}: RegistryInput): RegistryWrites {
  const writes: RegistryWrites = {
    regions: [],
    newClinics: [],
    clinicSlugs: [],
    clinicNames: [],
    clinicRegions: [],
    newTreatments: [],
    treatmentNames: [],
    offerings: [],
    procedures: [],
    events: [],
  };
  // Changes are relative to an earlier measurement. The first one only fills the registry.
  const hasPrevious = ctx.previousRun !== null;
  const event = (e: ChangeEvent) => {
    if (hasPrevious) writes.events.push(e);
  };
  const sumSlots = (match: (key: string) => boolean) => {
    const values = [...eprSlots].filter(([key]) => match(key)).map(([, n]) => n);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  const clinicSlots = (eprId: string) => sumSlots((key) => key.startsWith(`${eprId}|`));
  const treatmentSlots = (webKey: string) => sumSlots((key) => key.endsWith(`|${webKey}`));

  if (registry) {
    const clinics = webClinics(registry);
    const knownRegions = new Set(ctx.regions.keys());
    for (const clinic of clinics.values()) {
      if (!knownRegions.has(clinic.regionInternalKey)) {
        knownRegions.add(clinic.regionInternalKey);
        writes.regions.push({ key: clinic.regionInternalKey, name: clinic.regionName });
      }
      const stored = ctx.clinics.get(clinic.eprId);
      if (!stored) {
        writes.newClinics.push({
          eprId: clinic.eprId,
          slug: clinic.slug,
          name: clinic.name,
          city: clinic.city,
          regionKey: clinic.regionInternalKey,
        });
        event({
          kind: "clinic_added",
          eprId: clinic.eprId,
          webKey: null,
          before: null,
          after: { name: clinic.name },
          eprSlots: clinicSlots(clinic.eprId),
        });
        continue;
      }
      if (stored.slug !== clinic.slug) {
        writes.clinicSlugs.push({ eprId: clinic.eprId, slug: clinic.slug });
        if (stored.slug === null) {
          event({
            kind: "clinic_added",
            eprId: clinic.eprId,
            webKey: null,
            before: null,
            after: { name: clinic.name },
            eprSlots: clinicSlots(clinic.eprId),
          });
        }
      }
      if (stored.name !== clinic.name || stored.city !== clinic.city) {
        writes.clinicNames.push({ eprId: clinic.eprId, name: clinic.name, city: clinic.city });
      }
      if (stored.regionKey !== clinic.regionInternalKey) {
        writes.clinicRegions.push({ eprId: clinic.eprId, regionKey: clinic.regionInternalKey });
        if (stored.regionKey !== null) {
          event({
            kind: "clinic_region_changed",
            eprId: clinic.eprId,
            webKey: null,
            before: { region: stored.regionKey },
            after: { region: clinic.regionInternalKey },
            eprSlots: clinicSlots(clinic.eprId),
          });
        }
      }
    }
    for (const stored of ctx.clinics.values()) {
      if (stored.slug === null || clinics.has(stored.eprId)) continue;
      writes.clinicSlugs.push({ eprId: stored.eprId, slug: null });
      event({
        kind: "clinic_removed",
        eprId: stored.eprId,
        webKey: null,
        before: { name: stored.name },
        after: null,
        eprSlots: clinicSlots(stored.eprId),
      });
    }

    const inMenu = new Set<string>();
    for (const treatment of registry.treatments) {
      inMenu.add(treatment.internalKey);
      const stored = ctx.treatments.get(treatment.internalKey);
      const now = { name: treatment.name, slug: treatment.slug };
      if (!stored) {
        writes.newTreatments.push({ webKey: treatment.internalKey, ...now });
        event({
          kind: "treatment_added",
          eprId: null,
          webKey: treatment.internalKey,
          before: null,
          after: now,
          eprSlots: treatmentSlots(treatment.internalKey),
        });
      } else if (stored.name === null) {
        writes.treatmentNames.push({ webKey: treatment.internalKey, ...now });
        event({
          kind: "treatment_added",
          eprId: null,
          webKey: treatment.internalKey,
          before: null,
          after: now,
          eprSlots: treatmentSlots(treatment.internalKey),
        });
      } else if (stored.name !== treatment.name || stored.slug !== treatment.slug) {
        writes.treatmentNames.push({ webKey: treatment.internalKey, ...now });
        event({
          kind: "treatment_renamed",
          eprId: null,
          webKey: treatment.internalKey,
          before: { name: stored.name, slug: stored.slug },
          after: now,
          eprSlots: treatmentSlots(treatment.internalKey),
        });
      }
    }
    for (const stored of ctx.treatments.values()) {
      if (stored.name === null || inMenu.has(stored.webKey)) continue;
      writes.treatmentNames.push({ webKey: stored.webKey, name: null, slug: null });
      event({
        kind: "treatment_removed",
        eprId: null,
        webKey: stored.webKey,
        before: { name: stored.name, slug: stored.slug },
        after: null,
        eprSlots: treatmentSlots(stored.webKey),
      });
    }

    const previousMaxLead = ctx.previousRun?.maxLeadDays ?? null;
    if (previousMaxLead !== null && previousMaxLead !== registry.maxLeadDays) {
      event({
        kind: "max_lead_changed",
        eprId: null,
        webKey: null,
        before: { days: previousMaxLead },
        after: { days: registry.maxLeadDays },
        eprSlots: null,
      });
    }
  }

  // Offerings: every pair that is or was offered, and every pair the booking
  // system's list shows as activated.
  const selectable = new Set<string>();
  for (const [webKey, clinics] of registry?.selectable ?? []) {
    for (const clinic of clinics) selectable.add(pairKey(clinic.eprId, webKey));
  }
  const treatmentKeys = new Set([
    ...ctx.treatments.keys(),
    ...(registry?.treatments.map((t) => t.internalKey) ?? []),
  ]);
  const idsFor = (key: string) => {
    const ids = new Set(procedureIds.get(key) ?? ctx.procedures.get(key));
    const fallback = defaultProcedureId(key.split("|")[1] ?? "");
    if (fallback) ids.add(fallback);
    return ids;
  };
  const keys = new Set([...ctx.offerings.keys(), ...selectable, ...procedureIds.keys()]);
  for (const eprId of activation.keys()) {
    for (const webKey of treatmentKeys) {
      const key = pairKey(eprId, webKey);
      if ((activatedCaregivers(activation, eprId, idsFor(key)) ?? 0) > 0) keys.add(key);
    }
  }
  // Activation changes need an earlier read of the list to compare with.
  const activationKnown = ctx.activationFetchedAt !== null;

  for (const key of [...keys].sort()) {
    const [eprId = "", webKey = ""] = key.split("|");
    const stored = ctx.offerings.get(key);
    const webSelectable = registry ? selectable.has(key) : (stored?.webSelectable ?? false);
    const caregivers = activatedCaregivers(activation, eprId, idsFor(key));
    // Without this run's list: the stored value, or for a new pair whether the booking system shows slots.
    const eprActivated =
      caregivers !== null ? caregivers > 0 : (stored?.eprActivated ?? (eprSlots.get(key) ?? 0) > 0);
    const before = stored ?? { webSelectable: false, eprActivated: false };
    if (before.webSelectable === webSelectable && before.eprActivated === eprActivated) continue;
    if (stored || webSelectable || eprActivated)
      writes.offerings.push({ eprId, webKey, webSelectable, eprActivated });
    if (before.webSelectable !== webSelectable) {
      event({
        kind: "selectable_changed",
        eprId,
        webKey,
        before: { selectable: before.webSelectable },
        after: { selectable: webSelectable },
        eprSlots: eprSlots.get(key) ?? null,
      });
    }
    if (before.eprActivated !== eprActivated && caregivers !== null && activationKnown) {
      event({
        kind: "epr_activation_changed",
        eprId,
        webKey,
        before: { activated: before.eprActivated },
        after: { activated: eprActivated },
        eprSlots: eprSlots.get(key) ?? null,
      });
    }
  }

  for (const key of keys) {
    const [eprId = "", webKey = ""] = key.split("|");
    const stored = ctx.procedures.get(key) ?? new Set<string>();
    for (const procedureId of [...idsFor(key)].sort()) {
      if (!stored.has(procedureId)) writes.procedures.push({ eprId, webKey, procedureId });
    }
  }
  return writes;
}
