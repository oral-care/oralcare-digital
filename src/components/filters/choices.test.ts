import { describe, expect, it } from "vitest";

import { allIfEvery, matches, regionStates, toggled, toggledRegion, type ClinicChoice } from "./choices";

const clinics: ClinicChoice[] = [
  { id: 1, name: "Oral Care Botaniska", region: "Uppsala" },
  { id: 2, name: "Oral Care Kungsgatan", region: "Uppsala" },
  { id: 3, name: "Oral Care Stureplan", region: "Stockholm" },
  { id: 4, name: "Oral Care Narva", region: "Stockholm" },
  { id: 5, name: "Oral Care Kristianstad", region: "Skåne" },
];
const regions = ["Skåne", "Stockholm", "Uppsala"];

describe("clinics", () => {
  it("adds and removes a clinic", () => {
    expect(toggled([1], 3)).toEqual([1, 3]);
    expect(toggled([1, 3], 1)).toEqual([3]);
  });

  it("stores every clinic as all clinics", () => {
    expect(allIfEvery([5, 1, 2, 3, 4], 5)).toEqual([]);
    expect(allIfEvery([3, 1], 5)).toEqual([1, 3]);
  });

  it("searches on clinic and region", () => {
    expect(clinics.filter((c) => matches(c, "stock")).map((c) => c.id)).toEqual([3, 4]);
    expect(clinics.filter((c) => matches(c, " narva ")).map((c) => c.id)).toEqual([4]);
    expect(clinics.filter((c) => matches(c, "")).length).toBe(5);
  });
});

describe("regions", () => {
  it("chooses every clinic in a region, and removes them again", () => {
    expect(toggledRegion(clinics, [], "Uppsala")).toEqual([1, 2]);
    expect(toggledRegion(clinics, [1, 2, 5], "Uppsala")).toEqual([5]);
  });

  it("completes a region where only some clinics are chosen", () => {
    expect(toggledRegion(clinics, [3], "Stockholm")).toEqual([3, 4]);
  });

  it("is all clinics when the last region is chosen", () => {
    expect(toggledRegion(clinics, [1, 2, 3, 4], "Skåne")).toEqual([]);
  });

  it("marks full and partly chosen regions, and none for all clinics", () => {
    expect(regionStates(clinics, regions, [1, 2, 3])).toEqual({ full: ["Uppsala"], partial: ["Stockholm"] });
    expect(regionStates(clinics, regions, [])).toEqual({ full: [], partial: [] });
  });
});
