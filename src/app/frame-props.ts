import { getTranslations } from "next-intl/server";

import type { FrameUser } from "@/components/layout/frame";
import type { MarketOption } from "@/components/layout/market-switcher";
import type { NavGroup } from "@/components/layout/nav";
import { canOpenMarket, canOpenView, isAdmin, type Viewer } from "@/lib/auth/permissions";
import { dataStatus } from "@/lib/availability/data/status";
import { clock, shortDay } from "@/lib/email/format";
import { MARKETS, marketByCode, type MarketCode } from "@/lib/markets";
import { MODULES, USERS_PAGE } from "@/lib/modules";
import { zonedDay } from "@/lib/time";

// What the frame shows for this user and market (plan 3.3, 4.3 and 8.3): only
// the views they have, the markets with access marked, the time of the last
// measurement and the banner when the data is old.

export type FrameProps = {
  user: FrameUser;
  market?: MarketOption;
  markets?: MarketOption[];
  groups: NavGroup[];
  dataStatus?: string;
  banner?: string;
};

export async function frameProps(viewer: Viewer, market?: MarketCode): Promise<FrameProps> {
  const t = await getTranslations("frame");
  const user: FrameUser = {
    initials: `${viewer.firstName.charAt(0)}${viewer.lastName.charAt(0)}`.toUpperCase(),
    name: `${viewer.firstName} ${viewer.lastName}`,
    email: viewer.email,
  };
  if (!market) return { user, groups: [] };

  const href = (path: string) => `/${market}/${path}`;
  const groups: NavGroup[] = [];
  const availability = MODULES.find((m) => m.group === "availability" && canOpenView(viewer, m.key));
  if (availability) {
    groups.push({
      label: t("groups.availability"),
      items: availability.pages.map((p) => ({ href: href(p.path), label: p.name, icon: p.icon })),
    });
  }
  const soon = MODULES.filter((m) => m.group === "coming-soon" && canOpenView(viewer, m.key));
  if (soon.length > 0) {
    groups.push({
      label: t("groups.comingSoon"),
      soon: true,
      items: soon.map((m) => ({ href: href(m.path), label: m.name, icon: m.icon })),
    });
  }
  if (isAdmin(viewer)) {
    groups.push({
      label: t("groups.admin"),
      items: [{ href: href(USERS_PAGE.path), label: USERS_PAGE.name, icon: USERS_PAGE.icon }],
    });
  }

  const options: MarketOption[] = MARKETS.map((m) => ({
    code: m.code,
    name: m.name,
    brand: m.brand,
    allowed: canOpenMarket(viewer, m.code),
  }));
  const info = marketByCode(market);
  const status = await dataStatus(market);
  const tb = await getTranslations("banner");

  let statusText = t("noDataYet", { market: info.name });
  let banner: string | undefined;
  if (status?.kind === "measured") {
    const last = status.lastUpdated;
    const today = last !== null && zonedDay(last, info.timeZone) === zonedDay(new Date(), info.timeZone);
    if (last) {
      const time = clock(last, info.timeZone);
      statusText = today
        ? t("dataUpdatedToday", { time })
        : t("dataUpdatedOn", { date: shortDay(last, info.timeZone), time });
    }
    if (status.stale) {
      banner = last
        ? tb("stale", {
            time: today
              ? tb("today", { time: clock(last, info.timeZone) })
              : tb("on", { date: shortDay(last, info.timeZone), time: clock(last, info.timeZone) }),
          })
        : tb("staleNever");
    }
  }

  return {
    user,
    market: options.find((o) => o.code === market),
    markets: options,
    groups,
    dataStatus: statusText,
    banner,
  };
}
