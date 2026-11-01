import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { HeaderTip } from "@/components/data-table/header-tip";
import { CELL, NUM, PlainHeader, Table } from "@/components/data-table/table";
import { EmptyState } from "@/components/layout/empty-state";
import { formatCount } from "@/lib/availability/format";
import type { HiddenGroup } from "@/lib/availability/views";
import { cn } from "@/lib/utils";
import { dayLabel } from "@/lib/time";

import { HiddenGroupBody } from "./hidden-group";
import { Panel } from "./section";

// Patient vs Muntra (plan 4.7): grouped per clinic, the name once and lines
// only between clinics. Hovering highlights the whole clinic, and a click
// opens it. Without differences: "Nothing hidden".
export async function HiddenTable({
  groups,
  clinicHref,
}: {
  groups: HiddenGroup[];
  clinicHref: (clinicId: number) => string;
}) {
  const t = await getTranslations("availability");
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title={t("patientVsMuntra.nothingHidden")}
        text={t("patientVsMuntra.nothingHiddenText")}
      />
    );
  }
  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <HeaderTip label={t("columns.clinic")} tip={t("tips.clinic")} />
            <HeaderTip label={t("columns.treatment")} tip={t("tips.hiddenTreatment")} />
            <HeaderTip label={t("columns.onSite")} tip={t("tips.onSite")} numeric />
            <HeaderTip label={t("columns.availableInMuntra")} tip={t("tips.slotsInMuntra")} numeric />
            <HeaderTip label={t("columns.since")} tip={t("tips.since")} alignRight />
            <PlainHeader />
          </tr>
        </thead>
        {groups.map((group) => {
          const href = clinicHref(group.clinic.id);
          return (
            <HiddenGroupBody key={group.clinic.id} href={href}>
              {group.rows.map((row, i) => (
                <tr key={row.treatment.id}>
                  <td className={cn(CELL, "border-b-0")}>
                    {i === 0 ? (
                      <Link href={href} className="font-medium text-inherit no-underline focus-ring">
                        {group.clinic.name}
                      </Link>
                    ) : null}
                  </td>
                  <td className={cn(CELL, "border-b-0")}>{row.treatment.name}</td>
                  <td className={cn(CELL, NUM, "border-b-0")}>
                    {row.onSite === null ? (
                      <span className="text-muted-foreground">{t("status.notOnline")}</span>
                    ) : (
                      formatCount(row.onSite)
                    )}
                  </td>
                  <td className={cn(CELL, NUM, "border-b-0")}>
                    {row.inMuntra === null ? t("na") : formatCount(row.inMuntra)}
                  </td>
                  <td className={cn(CELL, "border-b-0 whitespace-nowrap text-muted-foreground")}>
                    {row.since ? dayLabel(row.since) : null}
                  </td>
                  <td className={cn(CELL, NUM, "border-b-0 text-muted-foreground")}>
                    {i === 0 ? <ChevronRight aria-hidden="true" className="ml-auto size-4" /> : null}
                  </td>
                </tr>
              ))}
            </HiddenGroupBody>
          );
        })}
      </Table>
    </Panel>
  );
}
