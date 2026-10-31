import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { MARKETS } from "@/lib/markets";

// src/lib/markets.ts is the source of truth; the migration's start values in
// core.country and core.market_source must match it (plan 10.1).

const urls = inject("databaseUrls");
let owner: Client;

beforeAll(async () => {
  owner = new Client({ connectionString: urls.owner });
  await owner.connect();
});

afterAll(async () => {
  await owner.end();
});

describe("markets", () => {
  it("match core.country", async () => {
    const result = await owner.query<{ code: string; name: string; brand: string; time_zone: string }>(
      "SELECT code, name, brand, time_zone FROM core.country ORDER BY id",
    );
    expect(result.rows).toEqual(
      MARKETS.map((m) => ({ code: m.code, name: m.name, brand: m.brand, time_zone: m.timeZone })),
    );
  });

  it("match core.market_source", async () => {
    const result = await owner.query<{ code: string; key: string }>(
      `SELECT c.code, s.key FROM core.market_source ms
       JOIN core.country c ON c.id = ms.country_id JOIN core.source_system s ON s.id = ms.source_system_id
       ORDER BY c.id, s.key`,
    );
    const expected = MARKETS.flatMap((m) => [...m.sources].sort().map((key) => ({ code: m.code, key })));
    expect(result.rows).toEqual(expected);
  });
});
