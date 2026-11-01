import "server-only";

import { cache } from "react";

import { canOpenMarket } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";
import { isStale } from "@/lib/availability/freshness";
import { appPool } from "@/lib/db/app";
import { marketByCode, type MarketCode } from "@/lib/markets";

// What the frame shows about the data (plan 4.3 and 8.3): when the market was
// last measured, and whether the banner should say the data is old.

export type DataStatus =
  { kind: "no-sources" } | { kind: "measured"; lastUpdated: Date | null; stale: boolean };

export const dataStatus = cache(async (market: MarketCode): Promise<DataStatus | null> => {
  const viewer = await getViewer();
  if (!viewer || !canOpenMarket(viewer, market)) return null;
  const info = marketByCode(market);
  if (info.sources.length === 0) return { kind: "no-sources" };
  const result = await appPool().query<{ finished_at: Date; schedule_point: Date }>(
    `SELECT r.finished_at, r.schedule_point FROM core.job_run r JOIN core.country c ON c.id = r.country_id
     WHERE r.job = 'availability' AND r.status = 'succeeded' AND c.code = $1
       AND r.schedule_point > now() - interval '2 days'
     ORDER BY r.finished_at DESC`,
    [market],
  );
  const last = result.rows[0]?.finished_at ?? null;
  return {
    kind: "measured",
    lastUpdated: last,
    stale: isStale(
      new Date(),
      result.rows.map((r) => r.schedule_point),
      info.timeZone,
    ),
  };
});
