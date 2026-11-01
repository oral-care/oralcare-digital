import { RefreshCw } from "lucide-react";

import { Logo } from "./logo";
import { MarketSwitcher, type MarketOption } from "./market-switcher";
import { Nav, type NavGroup } from "./nav";
import { SignOutButton } from "./sign-out-button";

export type FrameUser = { initials: string; name: string; email: string };

// The frame around every signed-in page (plan 4.3): the menu on the left,
// which stays put while the content scrolls, and the banner at the top of the
// content when the data is old (plan 8.3).
export function Frame({
  user,
  market,
  markets,
  groups,
  dataStatus,
  banner,
  children,
}: {
  user: FrameUser;
  market?: MarketOption;
  markets?: MarketOption[];
  groups: NavGroup[];
  dataStatus?: string;
  banner?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 flex h-dvh w-64 flex-none flex-col border-r border-border bg-card px-3 pt-5 pb-3">
        <div className="mb-4 px-2.5 py-1.5">
          <Logo size="small" />
        </div>
        {market && markets ? <MarketSwitcher current={market} options={markets} /> : null}
        <Nav groups={groups} />
        <div className="mt-auto border-t border-border pt-3">
          {dataStatus ? (
            <div className="flex h-8 items-center gap-2 px-2.5 text-paragraph-mini text-muted-foreground">
              <RefreshCw aria-hidden="true" className="size-3.5 flex-none" />
              {dataStatus}
            </div>
          ) : null}
          <div className="flex h-12 items-center gap-2.5 rounded-md pr-1 pl-2.5">
            <span
              aria-hidden="true"
              className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-oc-green-200 text-paragraph-nano font-semibold text-oc-green-600"
            >
              {user.initials}
            </span>
            <span className="min-w-0 flex-1 text-paragraph-small leading-4.5 font-medium">
              {user.name}
              <small className="block truncate text-paragraph-mini leading-4 font-normal text-muted-foreground">
                {user.email}
              </small>
            </span>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-12 pt-10 pb-20">
        <div className="mx-auto max-w-290">
          {banner ? (
            <p
              role="status"
              className="mb-6 rounded-lg border border-oc-orange-100 bg-oc-orange-50 px-4 py-3 text-paragraph-small text-attention"
            >
              {banner}
            </p>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
