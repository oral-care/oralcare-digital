import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHead } from "@/components/layout/page-head";
import { marketByCode, type MarketCode } from "@/lib/markets";

// The Availability pages until step 4 builds them: the heading, or for a
// market without a booking system connected, "No data for {market} yet"
// (plan 4.10). They show no data before step 3 is approved (plan 19).
export async function AvailabilityPlaceholder({ market, title }: { market: MarketCode; title: string }) {
  const info = marketByCode(market);
  if (info.sources.length > 0) return <PageHead title={title} />;
  const t = await getTranslations("noData");
  return (
    <>
      <PageHead title={title} />
      <EmptyState
        icon={Globe}
        title={t("title", { market: info.name })}
        text={t("text", { brand: info.brand })}
      />
    </>
  );
}
