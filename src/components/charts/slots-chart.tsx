"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { useFilters } from "@/components/filters/use-filters";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { withFilters } from "@/lib/availability/filters";
import { dayLabel, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

import { xTickIndexes, yTicks } from "./scale";
import type { ChartColor, ChartMarker, ChartSeries } from "./types";

// Free slots over time (plan 4.4 and 4.6): one line per treatment in its fixed
// colour, gaps for days without a daily value, and changes in the offering as
// a dashed orange line with a dot. Hovering shows a vertical line and a box
// with the date, each line's value and the day's changes. The legend under the
// chart hides and shows lines, kept in the address so a link shows the same.

const SWATCH: Record<ChartColor, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
  7: "bg-chart-7",
};

const number = new Intl.NumberFormat("en-GB");
const NO_CONFIG: ChartConfig = {};

/** The date under a tick; the first and last stay inside the chart. */
function DayTick({
  x,
  y,
  payload,
  first,
  last,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  first: string | undefined;
  last: string | undefined;
}) {
  if (x === undefined || y === undefined || !payload) return null;
  const anchor = payload.value === last ? "end" : payload.value === first ? "start" : "middle";
  return (
    <text x={x} y={y} dy={12} textAnchor={anchor} className="fill-muted-foreground">
      {shortDate(payload.value)}
    </text>
  );
}

/** The dot at the top of a change's dashed line. */
function MarkerDot({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
  if (viewBox?.x === undefined || viewBox.y === undefined) return null;
  return <circle cx={viewBox.x} cy={viewBox.y + 4} r={4} className="fill-chart-marker" />;
}

function Tip({
  active,
  label,
  days,
  series,
  markers,
}: {
  active?: boolean;
  label?: string | number;
  days: string[];
  series: ChartSeries[];
  markers: ChartMarker[];
}) {
  const t = useTranslations("chart");
  const day = typeof label === "string" ? label : undefined;
  if (!active || !day) return null;
  const index = days.indexOf(day);
  const changes = markers.filter((m) => m.day === day).flatMap((m) => m.lines);
  return (
    <div className="min-w-45 rounded-lg bg-card px-3 py-2.5 text-paragraph-mini leading-4.5 shadow-md ring-1 ring-foreground/10">
      <strong className="font-semibold">{dayLabel(day)}</strong>
      {series.map((s) => {
        const value = s.values[index] ?? null;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2 flex-none rounded-full", SWATCH[s.color])} />
            <span className="flex-1">{s.name}</span>
            <span className="tabular-nums">{value === null ? t("noValue") : number.format(value)}</span>
          </div>
        );
      })}
      {changes.length > 0 ? (
        <div className="mt-1.5 border-t border-border pt-1.5 text-attention">
          {changes.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SlotsChart({
  days,
  series,
  markers,
}: {
  days: string[];
  series: ChartSeries[];
  markers: ChartMarker[];
}) {
  const t = useTranslations("chart");
  const { filters, update } = useFilters();
  const hidden = filters.hidden;
  const visible = series.filter((s) => !hidden.includes(s.key));
  const ticks = yTicks(visible.flatMap((s) => s.values));
  const data = days.map((day, i) => ({
    day,
    ...Object.fromEntries(visible.map((s) => [s.key, s.values[i] ?? null])),
  }));
  const dayTicks = xTickIndexes(days.length).map((i) => days[i]!);
  const markerDays = [...new Set(markers.map((m) => m.day))].filter((day) => days.includes(day));
  const toggle = (key: string) =>
    update(
      withFilters(filters, {
        hidden: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key],
      }),
    );

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="relative px-5 pt-4 pb-3">
        <ChartContainer config={NO_CONFIG} className="aspect-auto h-70 w-full text-paragraph-nano">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} title={t("label")}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="day"
              ticks={dayTicks}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={<DayTick first={days[0]} last={days.at(-1)} />}
            />
            <YAxis
              domain={[0, ticks.at(-1) ?? 10]}
              ticks={ticks}
              interval={0}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => number.format(value)}
            />
            {markerDays.map((day) => (
              <ReferenceLine
                key={day}
                x={day}
                stroke="var(--chart-marker)"
                strokeDasharray="3 4"
                label={<MarkerDot />}
              />
            ))}
            <ChartTooltip
              cursor={{ stroke: "var(--chart-guide)" }}
              position={{ y: 0 }}
              isAnimationActive={false}
              content={<Tip days={days} series={visible} markers={markers} />}
            />
            {visible.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                type="linear"
                stroke={`var(--chart-${s.color})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 px-5 pb-4">
        {series.map((s) => {
          const off = hidden.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(s.key)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-2 rounded-full border border-border px-2.5 text-paragraph-mini focus-ring",
                off && "text-border-5",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 flex-none rounded-full", off ? "bg-border" : SWATCH[s.color])}
              />
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
