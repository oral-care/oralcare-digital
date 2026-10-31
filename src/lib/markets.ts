// The markets, their brands, the group's e-mail domains and the sources each
// market is measured with (plan 3.1 and 13.3). The source of truth: a migration
// fills core.country and core.market_source from this, and a test checks that
// they match.

export const MARKET_CODES = ["se", "no", "dk", "nl"] as const;
export type MarketCode = (typeof MARKET_CODES)[number];

export type Market = {
  code: MarketCode;
  name: string;
  brand: string;
  timeZone: string;
  /** The group's domain for this market, confirmed by IT in step 3. */
  emailDomain: string;
  /** Source system keys this market is measured with. Empty: "No data yet". */
  sources: readonly string[];
};

export const MARKETS: readonly Market[] = [
  {
    code: "se",
    name: "Sweden",
    brand: "Oral Care",
    timeZone: "Europe/Stockholm",
    emailDomain: "oralcare.se",
    sources: ["oralcare_se", "muntra"],
  },
  {
    code: "no",
    name: "Norway",
    brand: "OC Tannklinikker",
    timeZone: "Europe/Oslo",
    emailDomain: "octannklinikker.no",
    sources: [],
  },
  {
    code: "dk",
    name: "Denmark",
    brand: "Oral Care",
    timeZone: "Europe/Copenhagen",
    emailDomain: "oralcare.dk",
    sources: [],
  },
  {
    code: "nl",
    name: "Netherlands",
    brand: "Oral Care",
    timeZone: "Europe/Amsterdam",
    emailDomain: "oralcare.nl",
    sources: [],
  },
];

export function isMarketCode(value: string): value is MarketCode {
  return (MARKET_CODES as readonly string[]).includes(value);
}

export function marketByCode(code: MarketCode): Market {
  const market = MARKETS.find((m) => m.code === code);
  if (!market) throw new Error(`Unknown market ${code}`);
  return market;
}

/** Markets with at least one source, which the collector measures. */
export function measuredMarkets(): Market[] {
  return MARKETS.filter((m) => m.sources.length > 0);
}
