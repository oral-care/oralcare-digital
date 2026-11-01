import { describe, expect, it } from "vitest";

import { xTickIndexes, yTicks } from "./scale";

describe("y axis", () => {
  it("has four round steps with room above the highest value", () => {
    expect(yTicks([0, 120, 87])).toEqual([0, 50, 100, 150, 200]);
    expect(yTicks([3339])).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(yTicks([900])).toEqual([0, 250, 500, 750, 1000]);
  });

  it("is at least 10 high, also without values", () => {
    expect(yTicks([])).toEqual([0, 5, 10, 15, 20]);
    expect(yTicks([null, 2, null])).toEqual([0, 5, 10, 15, 20]);
  });
});

describe("x axis", () => {
  it("labels about seven days, counted back from the last", () => {
    expect(xTickIndexes(30)).toEqual([4, 9, 14, 19, 24, 29]);
    expect(xTickIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(xTickIndexes(90)).toEqual([11, 24, 37, 50, 63, 76, 89]);
  });

  it("always labels the only day", () => {
    expect(xTickIndexes(1)).toEqual([0]);
    expect(xTickIndexes(0)).toEqual([]);
  });
});
