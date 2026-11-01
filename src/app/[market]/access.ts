import { notFound, redirect } from "next/navigation";

import { canOpenMarket, canOpenView, homePath, isAdmin, type Viewer } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";
import type { ViewKey } from "@/lib/db/schema/auth";
import { isMarketCode, type MarketCode } from "@/lib/markets";

// Every page checks the user itself (plan 3.3 and 12): a market or view the
// user doesn't have sends them to their start page.

export async function requireMarket(param: string): Promise<{ viewer: Viewer; market: MarketCode }> {
  if (!isMarketCode(param)) notFound();
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  if (!canOpenMarket(viewer, param)) redirect(homePath(viewer));
  return { viewer, market: param };
}

export async function requireView(
  param: string,
  view: ViewKey,
): Promise<{ viewer: Viewer; market: MarketCode }> {
  const access = await requireMarket(param);
  if (!canOpenView(access.viewer, view)) redirect(homePath(access.viewer, access.market));
  return access;
}

export async function requireAdmin(param: string): Promise<{ viewer: Viewer; market: MarketCode }> {
  const access = await requireMarket(param);
  if (!isAdmin(access.viewer)) redirect(homePath(access.viewer, access.market));
  return access;
}
