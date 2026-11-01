import { Frame } from "@/components/layout/frame";

import { frameProps } from "../frame-props";
import { requireMarket } from "./access";

// The frame for every page in a market (plan 4.3).
export default async function MarketLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ market: string }>;
}) {
  const { viewer, market } = await requireMarket((await params).market);
  return <Frame {...await frameProps(viewer, market)}>{children}</Frame>;
}
