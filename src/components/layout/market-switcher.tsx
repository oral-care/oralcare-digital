"use client";

import { Check, ChevronsUpDown, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { Flag } from "./flag";

export type MarketOption = { code: string; name: string; brand: string; allowed: boolean };

/** The same page in another market. A clinic's page becomes Clinics, since clinics differ (plan 4.1). */
function samePageIn(pathname: string, code: string): string {
  const rest = pathname.split("/").slice(2).join("/");
  const page = /^availability\/clinics\/[^/]+/.test(rest) ? "availability/clinics" : rest;
  return `/${code}${page ? `/${page}` : ""}`;
}

// The market switcher at the top of the menu (plan 4.3): always open to use,
// every market with code, name and brand, a tick on the chosen one, and
// markets without access greyed out with a lock.
export function MarketSwitcher({ current, options }: { current: MarketOption; options: MarketOption[] }) {
  const t = useTranslations("frame");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("market")}
          className="mb-6 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left focus-ring hover:bg-secondary"
        >
          <Flag code={current.code} />
          <span className="min-w-0 flex-1 text-paragraph-small leading-4.5 font-medium">
            {current.name}
            <small className="block text-paragraph-mini leading-3.5 font-normal text-muted-foreground">
              {current.brand}
            </small>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) gap-0 p-1">
        {options.map((option) =>
          option.allowed ? (
            <Link
              key={option.code}
              href={samePageIn(pathname, option.code)}
              onClick={() => setOpen(false)}
              aria-current={option.code === current.code ? "true" : undefined}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-paragraph-small no-underline focus-ring hover:bg-muted/60"
            >
              <Flag code={option.code} />
              <span className="min-w-0 flex-1">
                {option.name}
                <span className="block text-paragraph-mini text-muted-foreground">{option.brand}</span>
              </span>
              <Check
                aria-hidden="true"
                className={cn("size-4", option.code !== current.code && "invisible")}
              />
            </Link>
          ) : (
            <div
              key={option.code}
              aria-disabled="true"
              title={t("noAccessTo", { market: option.name })}
              className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-paragraph-small text-muted-foreground"
            >
              <Flag code={option.code} />
              <span className="min-w-0 flex-1">
                {option.name}
                <span className="block text-paragraph-mini">{t("noAccess")}</span>
              </span>
              <Lock aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("noAccessTo", { market: option.name })}</span>
            </div>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}
