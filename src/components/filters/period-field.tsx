"use client";

import { format } from "date-fns";
import { Check, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { PRESET_PERIODS, periodRange, withFilters, type Filters } from "@/lib/availability/filters";
import { dayParts, monthStart, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

import { DropdownField } from "./dropdown-field";
import { Divider, Option, OptionList } from "./option-list";

// The period (plan 4.4): Last 7, 30 and 90 days, This month and Last month,
// and Custom period, which opens oralcare.se's calendar with two months.
// Future days and days before the first measurement can't be chosen, and Apply
// works first when both days are chosen.

/** The calendar shows the day as a date at local midnight; only its year, month and day are used. */
const toDate = (day: string) => {
  const { year, month, date } = dayParts(day);
  return new Date(year, month, date);
};
const toDay = (date: Date) => format(date, "yyyy-MM-dd");

/** The custom period being chosen: the clicked days in click order, and the left month shown. */
type Picking = { first: string | null; second: string | null; month: string };

export function PeriodField({
  filters,
  update,
  today,
  firstDay,
  open,
  onOpenChange,
  first,
}: {
  filters: Filters;
  update: (next: Filters) => void;
  today: string;
  firstDay: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The only field in the toolbar: the calendar opens to the right instead of the left. */
  first: boolean;
}) {
  const t = useTranslations("filters");
  const [picking, setPicking] = useState<Picking | null>(null);
  const range = periodRange(filters, today, firstDay);
  const custom = filters.period === "custom";
  const rangeText = (from: string, to: string) => t("range", { from: shortDate(from), to: shortDate(to) });

  const setOpen = (next: boolean) => {
    setPicking(null);
    onOpenChange(next);
  };
  const choose = (next: Filters) => {
    update(next);
    setOpen(false);
  };
  const startCustom = () =>
    setPicking(
      custom
        ? { first: range.from, second: range.to, month: monthStart(range.to, -1) }
        : { first: null, second: null, month: monthStart(today, -1) },
    );
  const pickDay = (day: string) =>
    setPicking((p) =>
      p === null
        ? p
        : p.second !== null || p.first === null
          ? { ...p, first: day, second: null }
          : { ...p, second: day },
    );

  const low = firstDay && firstDay < today ? firstDay : today;
  const ordered =
    picking?.first && picking.second
      ? picking.first <= picking.second
        ? { from: picking.first, to: picking.second }
        : { from: picking.second, to: picking.first }
      : null;

  return (
    <DropdownField
      label={t("period")}
      value={custom ? rangeText(range.from, range.to) : t(`periods.${filters.period}`)}
      open={open}
      onOpenChange={setOpen}
      wide={picking !== null}
      align={picking !== null && !first ? "end" : "start"}
    >
      {picking === null ? (
        <OptionList label={t("period")}>
          {PRESET_PERIODS.map((key) => (
            <Option
              key={key}
              selected={filters.period === key}
              onSelect={() => choose(withFilters(filters, { period: key, from: null, to: null }))}
              trail={
                <Check aria-hidden="true" className={cn("size-4", filters.period !== key && "invisible")} />
              }
            >
              {t(`periods.${key}`)}
            </Option>
          ))}
          <Divider />
          <Option
            selected={custom}
            onSelect={startCustom}
            hint={custom ? rangeText(range.from, range.to) : undefined}
            trail={<ChevronRight aria-hidden="true" className="size-4" />}
          >
            {t("periods.custom")}
          </Option>
        </OptionList>
      ) : (
        <div>
          <div className="px-4 pt-3 pb-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              weekStartsOn={1}
              showOutsideDays={false}
              month={toDate(picking.month)}
              onMonthChange={(month) => setPicking((p) => (p === null ? p : { ...p, month: toDay(month) }))}
              startMonth={toDate(monthStart(low < monthStart(today, -1) ? low : monthStart(today, -1)))}
              endMonth={toDate(monthStart(today))}
              today={toDate(today)}
              disabled={[{ after: toDate(today) }, ...(firstDay ? [{ before: toDate(firstDay) }] : [])]}
              selected={
                ordered
                  ? { from: toDate(ordered.from), to: toDate(ordered.to) }
                  : { from: picking.first ? toDate(picking.first) : undefined, to: undefined }
              }
              // The days are chosen as in the prototype, not by the calendar's own range
              // rules: a click after a full range starts a new one.
              onSelect={(_range, date, modifiers) => {
                if (!modifiers.disabled) pickDay(toDay(date));
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-paragraph-small">
            <span>
              {picking.first === null
                ? t("chooseStart")
                : ordered === null
                  ? t("chooseEnd")
                  : rangeText(ordered.from, ordered.to)}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(null)}>
                {t("back")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={ordered === null}
                onClick={() => {
                  if (ordered) choose(withFilters(filters, { period: "custom", ...ordered }));
                }}
              >
                {t("apply")}
              </Button>
            </span>
          </div>
        </div>
      )}
    </DropdownField>
  );
}
