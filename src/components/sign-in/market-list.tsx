import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Flag } from "@/components/layout/flag";

// Step 3 (plan 4.2): only for someone with several markets. Code, name and
// brand.
export function MarketList({
  markets,
}: {
  markets: { code: string; name: string; brand: string; href: string }[];
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {markets.map((market) => (
        <Link
          key={market.code}
          href={market.href}
          className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 text-left no-underline transition-colors focus-ring hover:border-ring hover:bg-oc-green-50"
        >
          <Flag code={market.code} large />
          <span className="flex-1 text-paragraph-small font-medium">
            {market.name}
            <small className="block text-paragraph-mini font-normal text-muted-foreground">
              {market.brand}
            </small>
          </span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      ))}
    </div>
  );
}
