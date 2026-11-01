// What a click in a filter menu does (plan 4.4). Clinics are the filter;
// regions are a quick way to choose all clinics in a region. Choosing every
// clinic is the same as all clinics, which the address stores as an empty
// list. Pure module.

export type ClinicChoice = { id: number; name: string; region: string };

/** The list with the id added, or removed when it is there. */
export function toggled(chosen: number[], id: number): number[] {
  return chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
}

/** Every clinic chosen is all clinics: an empty list. */
export function allIfEvery(chosen: number[], total: number): number[] {
  return chosen.length >= total ? [] : [...chosen].sort((a, b) => a - b);
}

export function clinicsIn(clinics: ClinicChoice[], region: string): number[] {
  return clinics.filter((c) => c.region === region).map((c) => c.id);
}

/** Regions where every clinic is chosen, and regions where only some are. */
export function regionStates(
  clinics: ClinicChoice[],
  regions: string[],
  chosen: number[],
): { full: string[]; partial: string[] } {
  const full: string[] = [];
  const partial: string[] = [];
  if (chosen.length === 0) return { full, partial };
  for (const region of regions) {
    const ids = clinicsIn(clinics, region);
    const count = ids.filter((id) => chosen.includes(id)).length;
    if (ids.length > 0 && count === ids.length) full.push(region);
    else if (count > 0) partial.push(region);
  }
  return { full, partial };
}

/** Choosing a region chooses all its clinics; choosing it again when all are chosen removes them. */
export function toggledRegion(clinics: ClinicChoice[], chosen: number[], region: string): number[] {
  const ids = clinicsIn(clinics, region);
  const full = chosen.length > 0 && ids.every((id) => chosen.includes(id));
  const next = full ? chosen.filter((id) => !ids.includes(id)) : [...new Set([...chosen, ...ids])];
  return allIfEvery(next, clinics.length);
}

/** Whether a clinic matches the search, on its name or its region. */
export function matches(clinic: ClinicChoice, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || `${clinic.name} ${clinic.region}`.toLowerCase().includes(q);
}
