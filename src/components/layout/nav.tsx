"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { filterSearch, parseFilters, periodOnly } from "@/lib/availability/filters";
import type { IconName } from "@/lib/modules";
import { cn } from "@/lib/utils";

import { MODULE_ICONS } from "./icons";

export type NavGroup = {
  label: string;
  soon?: boolean;
  items: { href: string; label: string; icon: IconName }[];
};

/** The link that best matches the page: itself, or the deepest one the page lies under. */
function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** An Availability page, which has the period filter. */
const hasPeriod = (href: string) => /\/availability(\/|$)/.test(href);

// The menu's groups (plan 4.3): only the views the user has. Coming soon
// modules are links too, but greyer until they are built. Between the
// Availability pages the menu keeps the period but not the clinic and
// treatment filters (plan 4.1).
export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const period = filterSearch(periodOnly(parseFilters(useSearchParams())));
  const active = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );
  return groups.map((group) => (
    <div key={group.label}>
      <div className="mb-1 px-2.5 text-paragraph-nano leading-4 font-semibold tracking-wider text-muted-foreground uppercase">
        {group.label}
      </div>
      <nav aria-label={group.label} className="mb-5 flex flex-col gap-px">
        {group.items.map((item) => {
          const Icon = MODULE_ICONS[item.icon];
          const current = item.href === active;
          return (
            <Link
              key={item.href}
              href={hasPeriod(item.href) ? `${item.href}${period}` : item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-paragraph-small no-underline focus-ring hover:bg-secondary",
                group.soon
                  ? "text-soon hover:text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground",
                current && "bg-secondary font-medium text-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4 flex-none" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  ));
}
