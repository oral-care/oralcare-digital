"use client";

import { ChevronDown } from "lucide-react";

import { EYEBROW } from "@/components/layout/eyebrow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A filter field in oralcare.se's DropdownField style, compact as in its
// clinic-list toolbar (plan 4.4): the small label over the value, a chevron
// that turns when the menu is open, and the menu under the field. Esc and a
// click outside close it.
export function DropdownField({
  label,
  value,
  open,
  onOpenChange,
  wide = false,
  align = "start",
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The calendar: as wide as its two months, without the list's padding. */
  wide?: boolean;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group/field flex w-55 cursor-pointer items-center gap-1 rounded-md bg-secondary py-2 pr-3 pl-4 text-left transition-colors focus-ring hover:bg-muted aria-expanded:bg-muted"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={EYEBROW}>{label}</span>
            <span className="truncate text-paragraph-regular leading-5 font-medium">{value}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-6 flex-none text-muted-foreground transition-transform group-aria-expanded/field:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className={cn(
          "w-max min-w-(--radix-popover-trigger-width) gap-0",
          wide ? "max-w-none p-0" : "max-w-85 p-1",
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
