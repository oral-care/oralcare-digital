"use client";

import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { withFilters } from "@/lib/availability/filters";

import { allIfEvery, matches, regionStates, toggled, toggledRegion } from "./choices";
import { DropdownField } from "./dropdown-field";
import { CheckMark, Divider, GroupTitle, Option, OptionList } from "./option-list";
import { PeriodField } from "./period-field";
import { useFilters } from "./use-filters";

export type FilterBarProps = {
  show: { clinics?: boolean; regions?: boolean; treatments?: boolean; period?: boolean };
  /** Every clinic in the market, by name. */
  clinics: { id: number; name: string; region: string }[];
  /** Every region, by name, with its number of clinics. */
  regions: { name: string; clinics: number }[];
  treatments: { id: number; name: string }[];
  /** Today and the first measured day, YYYY-MM-DD, for the period and its calendar. */
  today: string;
  firstDay: string | null;
};

type Field = "clinics" | "regions" | "treatments" | "period";

// The filters above a page (plan 4.4): Clinics, Regions, Treatments and Period,
// in that order, each with several choices and "All ..." on top. Every click
// changes the address at once, so the page and a shared link show the same.
export function FilterBar({ show, clinics, regions, treatments, today, firstDay }: FilterBarProps) {
  const t = useTranslations("filters");
  const { filters, update } = useFilters();
  const [open, setOpen] = useState<Field | null>(null);
  const [query, setQuery] = useState("");
  const openProps = (field: Field) => ({
    open: open === field,
    onOpenChange: (next: boolean) => {
      if (next && field === "clinics") setQuery("");
      setOpen(next ? field : null);
    },
  });

  const regionNames = regions.map((r) => r.name);
  const setClinics = (next: number[]) =>
    update(withFilters(filters, { clinics: allIfEvery(next, clinics.length) }));
  const setTreatments = (next: number[]) =>
    update(withFilters(filters, { treatments: allIfEvery(next, treatments.length), hidden: [] }));

  const nameText = <T extends { id: number; name: string }>(
    chosen: number[],
    list: T[],
    all: string,
    count: string,
  ) =>
    chosen.length === 0
      ? t(all)
      : chosen.length === 1
        ? (list.find((x) => x.id === chosen[0])?.name ?? t(count, { count: 1 }))
        : t(count, { count: chosen.length });

  const { full, partial } = regionStates(clinics, regionNames, filters.clinics);
  const chosenRegions = [...full, ...partial];
  const visibleRegions = regionNames
    .map((name) => ({ name, clinics: clinics.filter((c) => c.region === name && matches(c, query)) }))
    .filter((r) => r.clinics.length > 0);

  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {show.clinics ? (
        <DropdownField
          label={t("clinics")}
          value={nameText(filters.clinics, clinics, "allClinics", "clinicCount")}
          {...openProps("clinics")}
        >
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              event.currentTarget.nextElementSibling?.querySelector<HTMLElement>('[role="option"]')?.focus();
            }}
            placeholder={t("search")}
            aria-label={t("search")}
            className="mb-1 w-full rounded-md bg-secondary px-3 py-2 text-paragraph-small outline-none placeholder:text-muted-foreground"
          />
          <OptionList label={t("clinics")} multiple>
            <Option
              selected={filters.clinics.length === 0}
              onSelect={() => setClinics([])}
              lead={<CheckMark state={filters.clinics.length === 0 ? "checked" : "empty"} />}
            >
              {t("allClinics")}
            </Option>
            {visibleRegions.map((region) => (
              <Fragment key={region.name}>
                <GroupTitle>{region.name}</GroupTitle>
                {region.clinics.map((clinic) => {
                  const chosen = filters.clinics.includes(clinic.id);
                  return (
                    <Option
                      key={clinic.id}
                      selected={chosen}
                      onSelect={() => setClinics(toggled(filters.clinics, clinic.id))}
                      lead={<CheckMark state={chosen ? "checked" : "empty"} />}
                    >
                      {clinic.name}
                    </Option>
                  );
                })}
              </Fragment>
            ))}
          </OptionList>
        </DropdownField>
      ) : null}

      {show.regions ? (
        <DropdownField
          label={t("regions")}
          value={
            chosenRegions.length === 0
              ? t("allRegions")
              : chosenRegions.length === 1
                ? chosenRegions[0]!
                : t("regionCount", { count: chosenRegions.length })
          }
          {...openProps("regions")}
        >
          <OptionList label={t("regions")} multiple>
            <Option
              selected={chosenRegions.length === 0}
              onSelect={() => setClinics([])}
              lead={<CheckMark state={chosenRegions.length === 0 ? "checked" : "empty"} />}
            >
              {t("allRegions")}
            </Option>
            <Divider />
            {regions.map((region) => {
              const state = full.includes(region.name)
                ? "checked"
                : partial.includes(region.name)
                  ? "partial"
                  : "empty";
              return (
                <Option
                  key={region.name}
                  selected={state !== "empty"}
                  onSelect={() => setClinics(toggledRegion(clinics, filters.clinics, region.name))}
                  lead={<CheckMark state={state} />}
                  hint={t("clinicCount", { count: region.clinics })}
                >
                  {region.name}
                </Option>
              );
            })}
          </OptionList>
        </DropdownField>
      ) : null}

      {show.treatments ? (
        <DropdownField
          label={t("treatments")}
          value={nameText(filters.treatments, treatments, "allTreatments", "treatmentCount")}
          {...openProps("treatments")}
        >
          <OptionList label={t("treatments")} multiple>
            <Option
              selected={filters.treatments.length === 0}
              onSelect={() => setTreatments([])}
              lead={<CheckMark state={filters.treatments.length === 0 ? "checked" : "empty"} />}
            >
              {t("allTreatments")}
            </Option>
            <Divider />
            {treatments.map((treatment) => {
              const chosen = filters.treatments.includes(treatment.id);
              return (
                <Option
                  key={treatment.id}
                  selected={chosen}
                  onSelect={() => setTreatments(toggled(filters.treatments, treatment.id))}
                  lead={<CheckMark state={chosen ? "checked" : "empty"} />}
                >
                  {treatment.name}
                </Option>
              );
            })}
          </OptionList>
        </DropdownField>
      ) : null}

      {show.period ? (
        <PeriodField
          filters={filters}
          update={update}
          today={today}
          firstDay={firstDay}
          first={!show.clinics && !show.regions && !show.treatments}
          {...openProps("period")}
        />
      ) : null}
    </div>
  );
}
