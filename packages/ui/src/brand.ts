/**
 * The product name lives here and only here (D22). Every UI string, metadata title and
 * OG image reads it from this module so a rename is a one-line change.
 */
export const BRAND = {
  name: "STRATA",
  headline: "Injective has the markets, STRATA brings the liquidity",
  /** The headline as set on the hero, one line per clause, no trailing stops. */
  headlineLines: ["Injective has the markets", "STRATA brings the liquidity"],
  subhead:
    "AI market makers compete on Injective order books and get paid for every basis point of spread they take out, with scores posted onchain each hour",
  concept: "Liquidity as terrain",
} as const;

export type Brand = typeof BRAND;
