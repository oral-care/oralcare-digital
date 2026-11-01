"use client";

import { Check, Minus } from "lucide-react";

import { EYEBROW } from "@/components/layout/eyebrow";
import { cn } from "@/lib/utils";

// The rows in a filter menu: options with oralcare.se's checkbox, or with a
// tick for a single choice, group titles and dividers. The arrow keys move
// between the options.

export type CheckState = "checked" | "partial" | "empty";

/** oralcare.se's checkbox as a mark inside an option, which is the button itself. */
export function CheckMark({ state }: { state: CheckState }) {
  const Icon = state === "partial" ? Minus : Check;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 flex-none items-center justify-center rounded-md border-2",
        state === "empty"
          ? "border-oc-green-600 bg-white"
          : "border-primary bg-primary text-primary-foreground",
      )}
    >
      <Icon className={cn("size-3.5", state === "empty" && "invisible")} />
    </span>
  );
}

export function Option({
  selected,
  onSelect,
  lead,
  trail,
  hint,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  lead?: React.ReactNode;
  trail?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-paragraph-small focus-ring hover:bg-muted/60"
    >
      {lead}
      <span className="min-w-0 flex-1">
        {children}
        {hint ? <span className="text-paragraph-mini text-muted-foreground"> {hint}</span> : null}
      </span>
      {trail}
    </button>
  );
}

export function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className={cn(EYEBROW, "px-3 pt-2.5 pb-1")}>{children}</div>;
}

export function Divider() {
  return <div aria-hidden="true" className="-mx-1 my-1 h-px bg-border" />;
}

/** Moves the focus to the next or previous option with the arrow keys. */
function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  if (options.length === 0) return;
  event.preventDefault();
  const at = options.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1);
  options[at === -1 ? 0 : next]?.focus();
}

export function OptionList({
  label,
  multiple = false,
  children,
}: {
  label: string;
  multiple?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label={label}
      aria-multiselectable={multiple || undefined}
      onKeyDown={moveFocus}
      className="max-h-70 overflow-y-auto overscroll-contain"
    >
      {children}
    </div>
  );
}
