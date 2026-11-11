import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ClinicHeader, ClinicTreatmentsTable } from "@/components/availability/clinic-page";
import { Section } from "@/components/availability/section";
import { StatCard, StatGrid } from "@/components/availability/stat-card";
import { SlotsChart } from "@/components/charts/slots-chart";
import { FilterBar } from "@/components/filters/filter-bar";
import { marketData } from "@/lib/availability/data/market";
import { changesByDay, dailySums, measuredDays, valuesFor } from "@/lib/availability/data/series";
import { snapshotFor } from "@/lib/availability/data/snapshot";
import { clinicStatuses, webState } from "@/lib/availability/figures";
import { parseFilters, periodOnly, periodRange, type SearchParams } from "@/lib/availability/filters";
import { formatCount } from "@/lib/availability/format";
import { clinicSlotsNotOnline, clinicTreatmentRows, pairsOf } from "@/lib/availability/views";
import { isMarketCode } from "@/lib/markets";
import { dayLabel, daySpan } from "@/lib/time";

import { requireView } from "../../../access";
import { linkTo, loadMarket, periodText } from "../../shared";

type Params = Promise<{ market: string; clinicId: string }>;

const clinicIdOf = (param: string) => (/^\d+$/.test(param) ? Number(param) : null);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { market, clinicId } = await params;
  const data = isMarketCode(market) ? await marketData(market) : null;
  const clinic = data?.clinics.find((c) => c.id === clinicIdOf(clinicId));
  const t = await getTranslations("pages");
  return { title: clinic?.name ?? t("clinic") };
}

// A clinic's page (plan 4.6): its statuses, the two cards, every treatment on
// oralcare.se on the period's last day, and its free slots over the period.
// A clinic from another market is 404.
export default async function Clinic({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<SearchParams>;
}) {
  const { market: param, clinicId } = await params;
  const { market } = await requireView(param, "availability");
  // A market without data has no clinics, so any clinic is from another market.
  const loaded = await loadMarket(market, (await getTranslations("pages"))("clinic"));
  if ("content" in loaded) notFound();
  const { data } = loaded;
  const clinic = data.clinics.find((c) => c.id === clinicIdOf(clinicId));
  if (!clinic) notFound();
  const t = await getTranslations("availability");
  const filters = parseFilters(await searchParams);
  const range = periodRange(filters, data.today, data.firstDay);
  const days = daySpan(range.from, range.to);

  const [snapshot, sums, measured, markers, label] = await Promise.all([
    snapshotFor(data, range.to),
    dailySums(data, range, { by: "treatment", clinics: [clinic.id], treatments: null }),
    measuredDays(data, range, clinic.id),
    changesByDay(data, range, { clinics: null, treatments: null, onlyClinic: clinic.id }),
    periodText(filters, range),
  ]);
  const pairs = pairsOf(snapshot.pairs, clinic.id, null);
  const empty = snapshot.pairs.length === 0;
  // A treatment that could not be measured makes the count n/a (plan 5.7).
  const online = pairs.some((p) => webState(p) === "unknown")
    ? null
    : data.treatments.filter((tr) => pairs.some((p) => p.treatmentId === tr.id && webState(p) === "online"))
        .length;
  const hidden = clinicSlotsNotOnline(pairs);
  const series = data.treatments
    .map((treatment) => ({
      key: String(treatment.id),
      name: treatment.name,
      color: treatment.color,
      values: valuesFor(sums.get(treatment.id), days),
    }))
    .filter((s) => s.values.some((v) => v !== null));

  return (
    <>
      <ClinicHeader
        name={clinic.name}
        city={clinic.city}
        region={clinic.region}
        statuses={clinicStatuses(pairs, empty)}
        backHref={linkTo(market, "/clinics", periodOnly(filters))}
      />
      <div className="mb-8">
        <FilterBar
          show={{ period: true }}
          clinics={data.clinics}
          regions={data.regions}
          treatments={data.treatments}
          today={data.today}
          firstDay={data.firstDay}
        />
      </div>
      <Section>
        <StatGrid columns={2}>
          <StatCard
            label={t("cards.onSite.label")}
            value={online === null ? t("na") : formatCount(online)}
            unit={t("unit.ofTreatments", { total: data.treatments.length })}
            note={t("cards.onSite.note")}
          />
          <StatCard
            label={t("cards.slotsNotOnline.label")}
            value={hidden === null ? t("na") : formatCount(hidden)}
            unit={hidden === null ? "" : t("unit.slots", { count: hidden })}
            note={t("cards.slotsNotOnline.note")}
            attention={(hidden ?? 0) > 0}
          />
        </StatGrid>
      </Section>
      <Section
        title={t("clinic.treatments")}
        sub={t("dayNext14", { day: dayLabel(snapshot.day ?? range.to) })}
      >
        <ClinicTreatmentsTable
          rows={clinicTreatmentRows({ clinicId: clinic.id, treatments: data.treatments, pairs })}
        />
      </Section>
      <Section title={t("overTime")} sub={label}>
        <SlotsChart
          days={days}
          series={
            series.length > 0
              ? series
              : // Nothing online: a line at 0 on the days the clinic was measured, gaps on the rest (plan 4.6).
                [
                  {
                    key: "all",
                    name: t("clinic.allTreatments"),
                    color: 1,
                    values: days.map((day) => (measured.has(day) ? 0 : null)),
                  },
                ]
          }
          markers={markers}
        />
      </Section>
    </>
  );
}
