import type { Role, ViewKey } from "@/lib/db/schema/auth";
import { MARKET_CODES, type MarketCode } from "@/lib/markets";
import { MODULES } from "@/lib/modules";

// Who may open what (plan 3.3 and 11). A viewer reads the views and markets an
// admin has ticked; an admin also invites, changes and removes users, in every
// market. External accounts only ever get Tracking Framework. The data access
// layer, the server actions and the pages all use these rules. Pure module.

export type Viewer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  external: boolean;
  views: ViewKey[];
  markets: MarketCode[];
};

export const isAdmin = (viewer: Viewer) => viewer.role === "admin";

export function canOpenView(viewer: Viewer, view: ViewKey): boolean {
  if (viewer.external && view !== "tracking-framework") return false;
  return viewer.views.includes(view);
}

export const canOpenMarket = (viewer: Viewer, market: MarketCode) => viewer.markets.includes(market);

/** The viewer's views in menu order. */
export const openViews = (viewer: Viewer): ViewKey[] =>
  MODULES.map((m) => m.key).filter((key) => canOpenView(viewer, key));

/** The viewer's markets in the order of the market list. */
export const openMarkets = (viewer: Viewer): MarketCode[] =>
  MARKET_CODES.filter((code) => canOpenMarket(viewer, code));

/**
 * Where the viewer starts (plan 3.3 and 4.1): the first view in the given market
 * if they may open it, otherwise in their first market. Without a view or a
 * market: /no-access.
 */
export function homePath(viewer: Viewer, market?: string): string {
  const [view] = openViews(viewer);
  const markets = openMarkets(viewer);
  const chosen = markets.find((code) => code === market) ?? markets[0];
  if (!view || !chosen) return "/no-access";
  return `/${chosen}/${MODULES.find((m) => m.key === view)!.path}`;
}
