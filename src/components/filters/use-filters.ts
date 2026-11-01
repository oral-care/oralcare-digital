"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { filterSearch, parseFilters, type Filters } from "@/lib/availability/filters";

// The filters from the address, and a way to change them (plan 4.1). A change
// replaces the address without scrolling, so the page keeps its place, and is
// shown at once while the page loads the new data.
export function useFilters(): { filters: Filters; update: (next: Filters) => void } {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [filters, setFilters] = useOptimistic(parseFilters(params));
  const [, startTransition] = useTransition();
  const update = (next: Filters) =>
    startTransition(() => {
      setFilters(next);
      router.replace(`${pathname}${filterSearch(next)}`, { scroll: false });
    });
  return { filters, update };
}
