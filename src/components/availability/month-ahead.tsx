import { getTranslations } from "next-intl/server";

import type { MonthAhead } from "@/lib/availability/figures";
import { formatCount, formatShare } from "@/lib/availability/format";

import { Panel } from "./section";

// Month ahead (plan 5.6): the free online slots in the next 30 days in two
// short paragraphs, the largest first and the smallest second.
export async function MonthAheadText({ summary }: { summary: MonthAhead }) {
  const t = await getTranslations("availability.monthAhead");
  const b = (chunks: React.ReactNode) => <strong className="font-semibold">{chunks}</strong>;
  const paragraph = "max-w-190 text-summary";

  if (summary.kind === "none") {
    return (
      <Panel padded>
        <p className={paragraph}>{t("none")}</p>
      </Panel>
    );
  }
  if (summary.kind === "single") {
    return (
      <Panel padded>
        <p className={paragraph}>
          {t.rich("single", { b, total: formatCount(summary.total), clinic: summary.clinic })}
        </p>
      </Panel>
    );
  }
  const { largestRegion, smallestRegion } = summary;
  return (
    <Panel padded>
      <p className={paragraph}>
        {t.rich("many", {
          b,
          total: formatCount(summary.total),
          clinics: summary.clinics,
          regions: summary.regions,
        })}
        {largestRegion ? (
          <>
            {" "}
            {t.rich("largest", {
              b,
              region: largestRegion.name,
              clinics: largestRegion.clinics,
              share: formatShare(largestRegion.share),
            })}
          </>
        ) : null}{" "}
        {t.rich("most", { b, clinic: summary.mostClinic.name, share: formatShare(summary.mostClinic.share) })}
      </p>
      <p className={`${paragraph} mt-3`}>
        {smallestRegion ? (
          <>
            {t.rich("smallest", {
              b,
              region: smallestRegion.name,
              clinics: smallestRegion.clinics,
              share: formatShare(smallestRegion.share),
            })}{" "}
          </>
        ) : null}
        {t.rich("fewest", { b, clinic: summary.fewestClinic.name, slots: summary.fewestClinic.slots })}
      </p>
    </Panel>
  );
}
