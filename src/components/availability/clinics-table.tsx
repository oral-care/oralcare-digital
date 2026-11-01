import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ClickRow } from "@/components/data-table/click-row";
import { HeaderTip } from "@/components/data-table/header-tip";
import { CELL, NUM, PlainHeader, SortHeader, Table } from "@/components/data-table/table";
import type { SortKey } from "@/lib/availability/filters";
import { formatCount } from "@/lib/availability/format";
import type { ClinicListRow } from "@/lib/availability/views";
import { cn } from "@/lib/utils";

import { Panel } from "./section";
import { availabilityTone, StatusBadge, waitingTone } from "./status-badge";

// The Clinics list (plan 4.5): every clinic with how much of oralcare.se's
// offer it has online, its statuses and its slots not online.
export async function ClinicsTable({
  rows,
  sort,
  rowHref,
}: {
  rows: ClinicListRow[];
  /** Per sortable column: its link and whether it sorts now. */
  sort: Record<SortKey, { href: string; state: "asc" | "desc" | null }>;
  rowHref: (clinicId: number) => string;
}) {
  const t = await getTranslations("availability");
  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <HeaderTip label={t("columns.clinic")} tip={t("tips.clinic")} />
            <HeaderTip label={t("columns.region")} tip={t("tips.region")} />
            <SortHeader
              label={t("columns.onlineTreatments")}
              tip={t("tips.onlineTreatments")}
              {...sort.online}
            />
            <SortHeader
              label={t("columns.availability")}
              tip={t("tips.availabilityMixed")}
              {...sort.availability}
            />
            <SortHeader
              label={t("columns.waitingTime")}
              tip={t("tips.waitingTimeMixed")}
              alignRight
              {...sort.wait}
            />
            <SortHeader
              label={t("columns.slotsNotOnline")}
              tip={t("tips.slotsNotOnline")}
              numeric
              alignRight
              {...sort.notOnline}
            />
            <PlainHeader />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref(row.clinic.id);
            const availability = availabilityTone(row.statuses.availability);
            const waiting = waitingTone(row.statuses.waitingTime);
            const share = row.treatments > 0 ? Math.round((row.online / row.treatments) * 100) : 0;
            return (
              <ClickRow key={row.clinic.id} href={href}>
                <td className={CELL}>
                  <Link href={href} className="font-medium text-inherit no-underline focus-ring">
                    {row.clinic.name}
                  </Link>
                </td>
                <td className={cn(CELL, "text-muted-foreground")}>{row.clinic.region}</td>
                <td className={CELL}>
                  <span className="inline-flex items-center gap-3">
                    <span className="min-w-10 tabular-nums whitespace-nowrap">
                      {t("ofTotal", { count: row.online, total: row.treatments })}
                    </span>
                    <span
                      aria-hidden="true"
                      className="relative h-1 w-18 overflow-hidden rounded-xs bg-muted"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-(--value) rounded-xs bg-primary"
                        style={{ "--value": `${share}%` } as React.CSSProperties}
                      />
                    </span>
                  </span>
                </td>
                <td className={CELL}>
                  {availability ? (
                    <StatusBadge tone={availability}>{t(`status.${row.statuses.availability}`)}</StatusBadge>
                  ) : null}
                </td>
                <td className={CELL}>
                  {waiting ? (
                    <StatusBadge tone={waiting}>{t(`status.${row.statuses.waitingTime}`)}</StatusBadge>
                  ) : null}
                </td>
                <td className={cn(CELL, NUM)}>
                  {row.slotsNotOnline > 0 ? (
                    <strong className="font-semibold">{formatCount(row.slotsNotOnline)}</strong>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className={cn(CELL, NUM, "text-muted-foreground")}>
                  <ChevronRight aria-hidden="true" className="ml-auto size-4" />
                </td>
              </ClickRow>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}
