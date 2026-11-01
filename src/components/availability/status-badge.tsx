import type { ClinicAvailability, ClinicWaitingTime } from "@/lib/availability/figures";
import { cn } from "@/lib/utils";

// The statuses' look (plan 4.12): Good and Short green-grey, Low and Long light
// orange with an orange dot, Mixed grey with an orange dot, slots not online
// orange and Not online grey without a dot.

export type BadgeTone = "good" | "low" | "mixed" | "attention" | "neutral";

const TONE: Record<BadgeTone, { badge: string; dot: string | null }> = {
  good: { badge: "bg-status-good text-status-good-text", dot: "bg-current" },
  low: { badge: "bg-status-low text-status-low-text", dot: "bg-status-dot" },
  mixed: { badge: "bg-status-mixed text-status-mixed-text", dot: "bg-status-dot" },
  attention: { badge: "bg-status-attention text-status-attention-text", dot: "bg-current" },
  neutral: { badge: "bg-status-neutral text-status-neutral-text", dot: null },
};

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const { badge, dot } = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 text-paragraph-mini leading-5.5 font-medium whitespace-nowrap",
        badge,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} /> : null}
      {children}
    </span>
  );
}

/** The tone of a clinic's or treatment's availability; null shows nothing. */
export function availabilityTone(status: ClinicAvailability): BadgeTone | null {
  switch (status) {
    case "good":
      return "good";
    case "low":
      return "low";
    case "mixed":
      return "mixed";
    case "notOnline":
      return "neutral";
    case "unknown":
      return null;
  }
}

/** The tone of a waiting time; Not online and unknown show nothing in that column. */
export function waitingTone(status: ClinicWaitingTime): BadgeTone | null {
  switch (status) {
    case "short":
      return "good";
    case "long":
      return "low";
    case "mixed":
      return "mixed";
    case "notOnline":
    case "unknown":
      return null;
  }
}
