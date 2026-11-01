import { EYEBROW } from "@/components/layout/eyebrow";
import { cn } from "@/lib/utils";

// A column header with its explanation (plan 4.11): shown on hover and on
// keyboard focus, with a question-mark pointer and no icon. Near the right
// edge the box opens to the left, so it stays on the page.
export function HeaderTip({
  label,
  tip,
  alignRight = false,
  numeric = false,
}: {
  label: string;
  tip: string;
  /** Opens the box to the left, for the last columns. */
  alignRight?: boolean;
  /** A column of numbers, aligned right. */
  numeric?: boolean;
}) {
  return (
    <th
      tabIndex={0}
      className={cn(
        EYEBROW,
        "group relative cursor-help border-b border-border px-5 py-3 text-left focus-ring",
        numeric && "text-right",
      )}
    >
      {label}
      <span
        role="tooltip"
        className={cn(
          "absolute top-full z-40 -mt-1 hidden w-60 rounded-lg bg-card px-3 py-2.5 text-left text-paragraph-xs font-normal tracking-normal whitespace-pre-line text-foreground normal-case shadow-md ring-1 ring-foreground/10 group-focus-within:block group-hover:block",
          alignRight ? "right-3" : "left-3",
        )}
      >
        {tip}
      </span>
    </th>
  );
}
