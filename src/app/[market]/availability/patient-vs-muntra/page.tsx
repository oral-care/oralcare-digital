import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { HiddenTable } from "@/components/availability/hidden-table";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHead } from "@/components/layout/page-head";
import { hiddenSlots } from "@/lib/availability/data/hidden";
import { parseFilters, periodOnly, type SearchParams } from "@/lib/availability/filters";
import { hiddenGroups } from "@/lib/availability/views";

import { requireView } from "../../access";
import { chosen, linkTo, loadMarket } from "../shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("patientVsMuntra") };
}

// Patient vs Muntra (plan 4.7): free slots in Muntra that patients can't see
// on oralcare.se, in the latest measurement, per clinic.
export default async function PatientVsMuntra({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { market } = await requireView((await params).market, "availability");
  const title = (await getTranslations("pages"))("patientVsMuntra");
  const loaded = await loadMarket(market, title);
  if ("content" in loaded) return loaded.content;
  const { data } = loaded;
  const t = await getTranslations("availability");
  const filters = parseFilters(await searchParams);
  const chosenClinics = chosen(filters.clinics, data.clinics);

  return (
    <>
      <PageHead title={title} lead={t("lead.patientVsMuntra")} />
      <div className="mb-8">
        <FilterBar
          show={{ clinics: true }}
          clinics={data.clinics}
          regions={data.regions}
          treatments={data.treatments}
          today={data.today}
          firstDay={data.firstDay}
        />
      </div>
      <HiddenTable
        groups={hiddenGroups({
          clinics: chosenClinics.length > 0 ? chosenClinics : data.clinics,
          treatments: data.treatments,
          rows: await hiddenSlots(data),
        })}
        clinicHref={(clinicId) => linkTo(market, `/clinics/${clinicId}`, periodOnly(filters))}
      />
    </>
  );
}
