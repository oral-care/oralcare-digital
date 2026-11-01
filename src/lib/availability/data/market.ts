import "server-only";

import { cache } from "react";

import { canOpenMarket, canOpenView } from "@/lib/auth/permissions";
import type { ChartColor } from "@/lib/availability/figures";
import { getViewer } from "@/lib/auth/session";
import { appPool } from "@/lib/db/app";
import { marketByCode, type MarketCode } from "@/lib/markets";
import { zonedDay } from "@/lib/time";

// What every Availability page needs about a market (plan 4): the clinics on
// oralcare.se with their region, the treatments in the booking menu, the
// latest successful measurement and the first measured day. Null when the
// viewer may not open the market or the view. The other functions in this
// folder take the result, so they only run after this check.

export type RegistryClinic = { id: number; name: string; city: string; region: string };
export type RegistryTreatment = { id: number; name: string; webKey: string; color: ChartColor };

export type MarketData = {
  market: MarketCode;
  countryId: number;
  timeZone: string;
  webSourceId: number;
  eprSourceId: number;
  /** Clinics on oralcare.se, by name. */
  clinics: RegistryClinic[];
  /** Treatments in the booking menu, in the order they were first seen, each with its chart colour. */
  treatments: RegistryTreatment[];
  /** Regions by name, with how many clinics each has. */
  regions: { name: string; clinics: number }[];
  /** Today in the market's time zone. */
  today: string;
  /** The first day with a successful measurement, for the calendar. */
  firstDay: string | null;
  /** The latest successful measurement (plan 5.5). */
  latest: { runId: number; startedAt: Date; day: string } | null;
};

const byName = (a: string, b: string) => a.localeCompare(b, "sv");

export const marketData = cache(async (market: MarketCode): Promise<MarketData | null> => {
  const viewer = await getViewer();
  if (!viewer || !canOpenMarket(viewer, market) || !canOpenView(viewer, "availability")) return null;
  const info = marketByCode(market);
  const pool = appPool();

  const country = await pool.query<{ id: number }>("SELECT id FROM core.country WHERE code = $1", [market]);
  const countryId = country.rows[0]?.id;
  if (countryId === undefined) return null;
  const sources = await pool.query<{ id: number; role: string }>(
    `SELECT s.id, s.role FROM core.source_system s
     JOIN core.market_source ms ON ms.source_system_id = s.id WHERE ms.country_id = $1`,
    [countryId],
  );
  const webSourceId = sources.rows.find((s) => s.role === "web")?.id;
  const eprSourceId = sources.rows.find((s) => s.role === "epr")?.id;
  if (webSourceId === undefined || eprSourceId === undefined) return null;

  const [clinics, treatments, runs] = await Promise.all([
    pool.query<{ id: number; name: string; city: string; region: string | null }>(
      `SELECT c.id, n.name, n.city, r.name AS region
       FROM core.clinic c
       JOIN core.clinic_external_id w ON w.clinic_id = c.id AND w.source_system_id = $2 AND upper_inf(w.valid_during)
       JOIN core.clinic_name n ON n.clinic_id = c.id AND upper_inf(n.valid_during)
       LEFT JOIN core.clinic_region cr ON cr.clinic_id = c.id AND upper_inf(cr.valid_during)
       LEFT JOIN core.region r ON r.id = cr.region_id
       WHERE c.country_id = $1`,
      [countryId, webSourceId],
    ),
    pool.query<{ id: number; name: string; web_key: string }>(
      `SELECT t.id, n.name, t.web_key
       FROM core.treatment t
       JOIN core.treatment_name n ON n.treatment_id = t.id AND upper_inf(n.valid_during)
       WHERE t.country_id = $1
       ORDER BY t.id`,
      [countryId],
    ),
    pool.query<{ latest_id: number | null; latest_at: Date | null; first_at: Date | null }>(
      `SELECT (array_agg(r.id ORDER BY r.started_at DESC))[1] AS latest_id,
              max(r.started_at) AS latest_at, min(r.started_at) AS first_at
       FROM core.job_run r
       WHERE r.job = 'availability' AND r.status = 'succeeded' AND r.country_id = $1`,
      [countryId],
    ),
  ]);

  const clinicRows = clinics.rows
    .map((c) => ({ id: c.id, name: c.name, city: c.city, region: c.region ?? "" }))
    .sort((a, b) => byName(a.name, b.name));
  const regionCounts = new Map<string, number>();
  for (const c of clinicRows) regionCounts.set(c.region, (regionCounts.get(c.region) ?? 0) + 1);
  const run = runs.rows[0];

  return {
    market,
    countryId,
    timeZone: info.timeZone,
    webSourceId,
    eprSourceId,
    clinics: clinicRows,
    treatments: treatments.rows.map((t, i) => ({
      id: t.id,
      name: t.name,
      webKey: t.web_key,
      color: ((i % 7) + 1) as ChartColor,
    })),
    regions: [...regionCounts]
      .map(([name, count]) => ({ name, clinics: count }))
      .sort((a, b) => byName(a.name, b.name)),
    today: zonedDay(new Date(), info.timeZone),
    firstDay: run?.first_at ? zonedDay(run.first_at, info.timeZone) : null,
    latest:
      run?.latest_id && run.latest_at
        ? {
            runId: Number(run.latest_id),
            startedAt: run.latest_at,
            day: zonedDay(run.latest_at, info.timeZone),
          }
        : null,
  };
});
