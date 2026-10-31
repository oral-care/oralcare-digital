import { describe, expect, it } from "vitest";

import { schemaFits } from "./schema-version";

describe("schemaFits", () => {
  it("runs when the database is at the code's version", () => {
    expect(schemaFits({ schemaVersion: 3, minCodeSchema: 1 }, 3)).toBe(true);
  });

  it("runs when the database is newer, as during a deploy or after Instant Rollback", () => {
    expect(schemaFits({ schemaVersion: 4, minCodeSchema: 2 }, 3)).toBe(true);
  });

  it("skips when the database is older than the code needs", () => {
    expect(schemaFits({ schemaVersion: 2, minCodeSchema: 1 }, 3)).toBe(false);
  });

  it("skips when a contract migration has removed what the code still uses", () => {
    expect(schemaFits({ schemaVersion: 5, minCodeSchema: 4 }, 3)).toBe(false);
  });
});
