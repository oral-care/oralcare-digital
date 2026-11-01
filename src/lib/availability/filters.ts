import { z } from "zod";

import { addDays, daysBetween, isDay, monthStart } from "@/lib/time";

// The Availability pages' filters in the address (plan 4.1 and 13.3), so a
// view can be shared with a link: clinics, treatments, period, By treatment or
// By clinic, sorting and the chart lines that are hidden. One zod schema read
// by every page and by the filter menus. Regions are not a filter of their
// own: choosing a region chooses its clinics. Pure module.

export const PERIOD_KEYS = ["7", "30", "90", "month", "last", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PRESET_PERIODS = ["7", "30", "90", "month", "last"] as const satisfies readonly PeriodKey[];

export const DETAIL_VIEWS = ["treatment", "clinic"] as const;
export type DetailView = (typeof DETAIL_VIEWS)[number];

/** The Clinics list's sortable columns (plan 4.5). */
export const SORT_KEYS = ["online", "availability", "wait", "notOnline"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; desc: boolean };

export type Filters = {
  /** Clinic ids; empty means all clinics. */
  clinics: number[];
  /** Treatment ids; empty means all treatments. */
  treatments: number[];
  period: PeriodKey;
  /** The custom period's days, YYYY-MM-DD, only with period "custom". */
  from: string | null;
  to: string | null;
  view: DetailView;
  sort: Sort | null;
  /** Chart lines that are hidden: treatment ids, or "all" for a clinic's single line. */
  hidden: string[];
};

export const DEFAULT_FILTERS: Filters = {
  clinics: [],
  treatments: [],
  period: "30",
  from: null,
  to: null,
  view: "treatment",
  sort: null,
  hidden: [],
};

const ids = z
  .string()
  .transform((text) =>
    [...new Set(text.split(",").map(Number))]
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b),
  );
const day = z.string().refine(isDay);
const sort = z
  .string()
  .regex(new RegExp(`^-?(${SORT_KEYS.join("|")})$`))
  .transform((text): Sort => ({ key: text.replace("-", "") as SortKey, desc: text.startsWith("-") }));
const keys = z
  .string()
  .transform((text) => [...new Set(text.split(",").filter((k) => /^(\d+|all)$/.test(k)))]);

const schema = z.object({
  c: ids.catch([]),
  t: ids.catch([]),
  p: z.enum(PERIOD_KEYS).catch(DEFAULT_FILTERS.period),
  from: day.nullable().catch(null),
  to: day.nullable().catch(null),
  v: z.enum(DETAIL_VIEWS).catch(DEFAULT_FILTERS.view),
  sort: sort.nullable().catch(null),
  hide: keys.catch([]),
});

export type SearchParams = Record<string, string | string[] | undefined>;

/** The filters from the address. Anything that doesn't parse falls back to its default. */
export function parseFilters(params: SearchParams | URLSearchParams): Filters {
  const first = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return Array.isArray(value) ? value[0] : (value ?? undefined);
  };
  const raw = schema.parse({
    c: first("c"),
    t: first("t"),
    p: first("p"),
    from: first("from") ?? null,
    to: first("to") ?? null,
    v: first("v"),
    sort: first("sort") ?? null,
    hide: first("hide"),
  });
  // A custom period needs both days; without them it is the default.
  const custom = raw.p === "custom" && raw.from !== null && raw.to !== null;
  return {
    clinics: raw.c,
    treatments: raw.t,
    period: raw.p === "custom" && !custom ? DEFAULT_FILTERS.period : raw.p,
    from: custom ? raw.from : null,
    to: custom ? raw.to : null,
    view: raw.v,
    sort: raw.sort,
    hidden: raw.hide,
  };
}

/** The query string for the filters, without the defaults, as "?c=1,2&p=7" or "". */
export function filterSearch(filters: Filters): string {
  const parts: string[] = [];
  if (filters.clinics.length > 0) parts.push(`c=${filters.clinics.join(",")}`);
  if (filters.treatments.length > 0) parts.push(`t=${filters.treatments.join(",")}`);
  if (filters.period !== DEFAULT_FILTERS.period) parts.push(`p=${filters.period}`);
  if (filters.period === "custom" && filters.from && filters.to) {
    parts.push(`from=${filters.from}`, `to=${filters.to}`);
  }
  if (filters.view !== DEFAULT_FILTERS.view) parts.push(`v=${filters.view}`);
  if (filters.sort) parts.push(`sort=${filters.sort.desc ? "-" : ""}${filters.sort.key}`);
  if (filters.hidden.length > 0) parts.push(`hide=${filters.hidden.join(",")}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** The filters with some of them changed. */
export function withFilters(filters: Filters, change: Partial<Filters>): Filters {
  return { ...filters, ...change };
}

/** Only the period: what the menu keeps between pages (plan 4.1). */
export function periodOnly(filters: Filters): Filters {
  return { ...DEFAULT_FILTERS, period: filters.period, from: filters.from, to: filters.to };
}

/** A period as its first and last day, both included. */
export type DayRange = { from: string; to: string };

/**
 * The period's days (plan 5.5). Last 7, 30 and 90 days count back from today,
 * This month and Last month follow the calendar, and a custom period stays
 * between the first measured day and today.
 */
export function periodRange(filters: Filters, today: string, firstDay: string | null): DayRange {
  switch (filters.period) {
    case "7":
      return { from: addDays(today, -6), to: today };
    case "90":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: monthStart(today), to: today };
    case "last":
      return { from: monthStart(today, -1), to: addDays(monthStart(today), -1) };
    case "custom": {
      if (!filters.from || !filters.to) break;
      const [a, b] = filters.from <= filters.to ? [filters.from, filters.to] : [filters.to, filters.from];
      const low = firstDay && firstDay <= today ? firstDay : a;
      const from = a < low ? low : a > today ? today : a;
      const to = b > today ? today : b < from ? from : b;
      return { from, to };
    }
    case "30":
      break;
  }
  return { from: addDays(today, -29), to: today };
}

/** The same number of days just before the period, for "Vs previous period" (plan 5.5). */
export function previousRange(range: DayRange): DayRange {
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}
