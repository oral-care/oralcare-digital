// What the chart "Free slots over time" shows (plan 4.4 and 4.6). The pages
// build these from the daily values; the chart only draws them.

import type { ChartColor } from "@/lib/availability/figures";

export type { ChartColor };

/** A line: a treatment, with one value per day in the chart's days. Null is a day without a daily value. */
export type ChartSeries = { key: string; name: string; color: ChartColor; values: (number | null)[] };

/** Changes in the offering on a day, as the lines the tooltip shows. */
export type ChartMarker = { day: string; lines: string[] };
