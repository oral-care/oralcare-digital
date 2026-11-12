import type { ClinicStatuses } from "@/lib/availability/figures";
import type { FirstFree } from "@/lib/availability/views";
import { shortDate } from "@/lib/time";

// Shared texts for the tables, given the "availability" translations.

type T = (key: string, values?: Record<string, string | number>) => string;

/** Today, 1 day, {N} days or None in {N} days, where N is how far oralcare.se was searched (plan 5.4). */
export function waitText(t: T, first: FirstFree): string {
  if ("noneIn" in first) return t("wait.none", { count: first.noneIn });
  return first.days === 0 ? t("wait.today") : t("wait.days", { count: first.days });
}

/** First slot 7 Dec: not online, but bookable later (plan 5.1). */
export function firstSlotText(t: T, day: string): string {
  return t("status.later", { day: shortDate(day) });
}

/** None in 30 days: a measurement before the change found nothing in the days it searched (plan 5.1). */
export function noneInText(t: T, days: number): string {
  return t("wait.none", { count: days });
}

/** A clinic's availability as its badge says it. */
export function availabilityText(t: T, statuses: ClinicStatuses): string {
  if (statuses.availability === "later" && statuses.firstSlot) return firstSlotText(t, statuses.firstSlot);
  if (statuses.availability === "noneInWindow" && statuses.noneIn) return noneInText(t, statuses.noneIn);
  return t(`status.${statuses.availability}`);
}
