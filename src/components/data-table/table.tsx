import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import Link from "next/link";

import { EYEBROW } from "@/components/layout/eyebrow";
import { cn } from "@/lib/utils";

// The tables' parts (plan 4.4-4.7): the cell styles, a plain header, and a
// sortable header with its explanation. Rows open a page with ClickRow.

/** A cell: the same padding and line in every table; the last row has no line. */
export const CELL = "border-b border-border px-5 py-3.5 align-middle text-paragraph-small";
/** A row: the last one has no line under it, since the box has its own border. */
export const ROW = "last:*:border-b-0";
/** A column of numbers. */
export const NUM = "text-right tabular-nums whitespace-nowrap";

export function Table({ children }: { children: React.ReactNode }) {
  return <table className="w-full border-collapse">{children}</table>;
}

/** A header without an explanation, such as the arrow column. */
export function PlainHeader({ children }: { children?: React.ReactNode }) {
  return <th className={cn(EYEBROW, "border-b border-border px-5 py-3 text-left")}>{children}</th>;
}

/**
 * A header that sorts the table (plan 4.5): a link to the same page with the
 * sorting in the address. The arrow shows which column and which way, and the
 * explanation shows on hover and focus.
 */
export function SortHeader({
  label,
  tip,
  href,
  state,
  numeric = false,
  alignRight = false,
}: {
  label: string;
  tip: string;
  href: string;
  state: "asc" | "desc" | null;
  numeric?: boolean;
  alignRight?: boolean;
}) {
  const Icon = state === "asc" ? ChevronDown : state === "desc" ? ChevronUp : ChevronsUpDown;
  return (
    <th
      aria-sort={state === "asc" ? "ascending" : state === "desc" ? "descending" : "none"}
      className={cn(
        EYEBROW,
        "group relative cursor-help border-b border-border px-5 py-3 text-left",
        numeric && "text-right",
      )}
    >
      <Link
        href={href}
        scroll={false}
        className={cn(
          "-mx-1.5 -my-1 inline-flex cursor-help items-center gap-1 rounded-md px-1.5 py-1 no-underline focus-ring hover:bg-secondary hover:text-foreground",
          state ? "text-foreground" : "text-inherit",
        )}
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", state ? "text-foreground" : "text-muted-foreground")}
        />
      </Link>
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
