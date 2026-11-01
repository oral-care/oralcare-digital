import { Globe, RefreshCw } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHead } from "@/components/layout/page-head";
import { marketData, type MarketData } from "@/lib/availability/data/market";
import { filterSearch, withFilters, type DayRange, type Filters } from "@/lib/availability/filters";
import { marketByCode, type MarketCode } from "@/lib/markets";
import { shortDate } from "@/lib/time";

// What the Availability pages share: the market's data, or the page to show
// when there is none yet (plan 4.10), the chosen clinics and treatments, the
// period's name and the links that keep the filters.

export async function loadMarket(
  market: MarketCode,
  title: string,
): Promise<{ data: MarketData } | { content: React.ReactNode }> {
  const info = marketByCode(market);
  const data = info.sources.length > 0 ? await marketData(market) : null;
  if (!data) {
    const t = await getTranslations("noData");
    return {
      content: (
        <>
          <PageHead title={title} />
          <EmptyState
            icon={Globe}
            title={t("title", { market: info.name })}
            text={t("text", { brand: info.brand })}
          />
        </>
      ),
    };
  }
  if (!data.latest) {
    const t = await getTranslations("availability.noMeasurement");
    return {
      content: (
        <>
          <PageHead title={title} />
          <EmptyState icon={RefreshCw} title={t("title")} text={t("text", { market: info.name })} />
        </>
      ),
    };
  }
  return { data };
}

/** The ids in the filter that exist in this market; empty means all. */
export function chosen<T extends { id: number }>(ids: number[], all: T[]): T[] {
  const known = all.filter((item) => ids.includes(item.id));
  return known;
}

/** "Last 30 days", or a custom period as "29 Sep to 28 Oct". */
export async function periodText(filters: Filters, range: DayRange): Promise<string> {
  const t = await getTranslations("filters");
  return filters.period === "custom"
    ? t("range", { from: shortDate(range.from), to: shortDate(range.to) })
    : t(`periods.${filters.period}`);
}

/** A link within the market's Availability pages, with the filters changed. */
export function linkTo(
  market: MarketCode,
  path: string,
  filters: Filters,
  change: Partial<Filters> = {},
): string {
  return `/${market}/availability${path}${filterSearch(withFilters(filters, change))}`;
}
