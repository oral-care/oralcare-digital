import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ClinicsTable } from "@/components/availability/clinics-table";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHead } from "@/components/layout/page-head";
import { latestPairs } from "@/lib/availability/data/snapshot";
import {
  parseFilters,
  periodOnly,
  SORT_KEYS,
  type SearchParams,
  type SortKey,
} from "@/lib/availability/filters";
import { clinicListRows } from "@/lib/availability/views";

import { requireView } from "../../access";
import { chosen, linkTo, loadMarket } from "../shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("clinics") };
}

// Clinics (plan 4.5): every clinic in the filter as it is today, with its own
// page. Sorting is in the address; the same column again reverses it.
export default async function Clinics({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { market } = await requireView((await params).market, "availability");
  const title = (await getTranslations("pages"))("clinics");
  const loaded = await loadMarket(market, title);
  if ("content" in loaded) return loaded.content;
  const { data } = loaded;
  const t = await getTranslations("availability");
  const filters = parseFilters(await searchParams);
  const chosenClinics = chosen(filters.clinics, data.clinics);
  const pairs = await latestPairs(data);

  const sort = Object.fromEntries(
    SORT_KEYS.map((key) => {
      const on = filters.sort?.key === key ? filters.sort : null;
      const state = on ? (on.desc ? "desc" : "asc") : null;
      return [
        key,
        {
          href: linkTo(market, "/clinics", filters, { sort: { key, desc: state === "asc" } }),
          state,
        },
      ];
    }),
  ) as Record<SortKey, { href: string; state: "asc" | "desc" | null }>;

  return (
    <>
      <PageHead title={title} lead={t("lead.clinics")} />
      <div className="mb-8">
        <FilterBar
          show={{ clinics: true, regions: true }}
          clinics={data.clinics}
          regions={data.regions}
          treatments={data.treatments}
          today={data.today}
          firstDay={data.firstDay}
        />
      </div>
      <ClinicsTable
        rows={clinicListRows({
          clinics: chosenClinics.length > 0 ? chosenClinics : data.clinics,
          treatments: data.treatments,
          pairs,
          snapshotEmpty: pairs.length === 0,
          sort: filters.sort,
        })}
        sort={sort}
        rowHref={(clinicId) => linkTo(market, `/clinics/${clinicId}`, periodOnly(filters))}
      />
    </>
  );
}
