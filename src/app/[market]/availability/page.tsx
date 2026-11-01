import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ByClinicTable, ByTreatmentTable, DetailSwitch } from "@/components/availability/details";
import { MonthAheadText } from "@/components/availability/month-ahead";
import { Panel, Section } from "@/components/availability/section";
import { TodayCards } from "@/components/availability/today-cards";
import { SlotsChart } from "@/components/charts/slots-chart";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHead } from "@/components/layout/page-head";
import { changesByDay, dailySums, valuesFor } from "@/lib/availability/data/series";
import { latestPairs, snapshotFor } from "@/lib/availability/data/snapshot";
import { cardCounts, clinicStatuses, monthAhead } from "@/lib/availability/figures";
import { parseFilters, periodRange, previousRange, type SearchParams } from "@/lib/availability/filters";
import { clinicRows, clinicsWithSlotsNotOnline, pairsOf, treatmentRows } from "@/lib/availability/views";
import { daySpan, dayLabel } from "@/lib/time";

import { requireView } from "../access";
import { chosen, linkTo, loadMarket, periodText } from "./shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("whatPatientsSee") };
}

// What patients see (plan 4.4): today's cards, Month ahead, the free slots
// over the period and the details per treatment or clinic, for the filters
// in the address.
export default async function WhatPatientsSee({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { market } = await requireView((await params).market, "availability");
  const title = (await getTranslations("pages"))("whatPatientsSee");
  const loaded = await loadMarket(market, title);
  if ("content" in loaded) return loaded.content;
  const { data } = loaded;
  const t = await getTranslations("availability");
  const filters = parseFilters(await searchParams);

  const chosenClinics = chosen(filters.clinics, data.clinics);
  const chosenTreatments = chosen(filters.treatments, data.treatments);
  const clinics = chosenClinics.length > 0 ? chosenClinics : data.clinics;
  const treatments = chosenTreatments.length > 0 ? chosenTreatments : data.treatments;
  const clinicIds = chosenClinics.length > 0 ? clinics.map((c) => c.id) : null;
  const treatmentIds = chosenTreatments.length > 0 ? treatments.map((tr) => tr.id) : null;

  const head = (
    <>
      <PageHead title={title} lead={t("lead.whatPatientsSee")} />
      <div className="mb-8">
        <FilterBar
          show={{ clinics: true, regions: true, treatments: true, period: true }}
          clinics={data.clinics}
          regions={data.regions}
          treatments={data.treatments}
          today={data.today}
          firstDay={data.firstDay}
        />
      </div>
    </>
  );
  if (filters.clinics.length > 0 && chosenClinics.length === 0) {
    return (
      <>
        {head}
        <Panel>
          <div className="px-6 py-14 text-center">
            <h2 className="mb-1.5 text-paragraph-large font-semibold">{t("nothingMatches.title")}</h2>
            <Link
              href={linkTo(market, "", filters, { clinics: [], treatments: [] })}
              className="text-paragraph-small focus-ring"
            >
              {t("nothingMatches.clear")}
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  const range = periodRange(filters, data.today, data.firstDay);
  const previous = previousRange(range);
  const days = daySpan(range.from, range.to);
  const previousDays = daySpan(previous.from, previous.to);
  const clinicSet = new Set(clinics.map((c) => c.id));
  const treatmentSet = treatmentIds ? new Set(treatmentIds) : null;
  const single = treatmentIds?.length === 1 ? treatmentIds[0]! : null;

  const [snapshot, latest, totals, markers, clinicSums, label] = await Promise.all([
    snapshotFor(data, range.to),
    latestPairs(data),
    dailySums(
      data,
      { from: previous.from, to: range.to },
      { by: "treatment", clinics: clinicIds, treatments: treatmentIds },
    ),
    changesByDay(data, range, { clinics: clinicIds, treatments: treatmentIds }),
    single !== null && filters.view === "clinic"
      ? dailySums(data, range, { by: "clinic", clinics: clinicIds, treatments: [single] })
      : Promise.resolve(new Map<number, Map<string, number>>()),
    periodText(filters, range),
  ]);
  const empty = snapshot.pairs.length === 0;
  const inFilter = snapshot.pairs.filter(
    (p) => clinicSet.has(p.clinicId) && (!treatmentSet || treatmentSet.has(p.treatmentId)),
  );
  const counts = cardCounts(
    clinics.map((c) => clinicStatuses(pairsOf(inFilter, c.id, null), empty)),
    clinicsWithSlotsNotOnline(snapshot.pairs, clinicSet, treatmentSet),
  );
  const heading = snapshot.isToday ? t("today") : dayLabel(snapshot.day ?? range.to);
  const ahead = monthAhead(
    latest.filter((p) => !treatmentSet || treatmentSet.has(p.treatmentId)),
    new Map(clinics.map((c) => [c.id, c])),
  );
  const series = treatments
    .map((treatment) => ({
      key: String(treatment.id),
      name: treatment.name,
      color: treatment.color,
      values: valuesFor(totals.get(treatment.id), days),
    }))
    .filter((s) => s.values.some((v) => v !== null));

  return (
    <>
      {head}
      <Section title={heading} sub={t("next14", { clinics: clinics.length })}>
        <TodayCards
          counts={counts}
          hiddenHref={linkTo(market, "/patient-vs-muntra", filters, {
            treatments: [],
            view: "treatment",
            sort: null,
            hidden: [],
          })}
        />
      </Section>
      <Section title={t("monthAhead.title")} sub={t("monthAhead.sub")}>
        <MonthAheadText summary={ahead} />
      </Section>
      <Section title={t("overTime")} sub={label}>
        <SlotsChart days={days} series={series} markers={markers} />
      </Section>
      <Section
        title={t("details.title")}
        action={
          <DetailSwitch
            view={filters.view}
            hrefs={{
              treatment: linkTo(market, "", filters, { view: "treatment" }),
              clinic: linkTo(market, "", filters, { view: "clinic" }),
            }}
          />
        }
      >
        {filters.view === "clinic" ? (
          <ByClinicTable
            rows={clinicRows({
              clinics,
              treatments,
              pairs: inFilter,
              snapshotEmpty: empty,
              single,
              spark: (clinicId) => valuesFor(clinicSums.get(clinicId), days),
            })}
            single={single !== null}
            periodLabel={label}
            rowHref={(clinicId) =>
              linkTo(market, `/clinics/${clinicId}`, filters, { view: "treatment", sort: null, hidden: [] })
            }
          />
        ) : (
          <ByTreatmentTable
            rows={treatmentRows({
              treatments,
              pairs: inFilter,
              clinics: clinicSet,
              spark: (id) => valuesFor(totals.get(id), days),
              previous: (id) => valuesFor(totals.get(id), previousDays),
            })}
            periodLabel={label}
            rowHref={(id) => linkTo(market, "", filters, { treatments: [id], view: "clinic", hidden: [] })}
          />
        )}
      </Section>
    </>
  );
}
