/**
 * The product name lives here and only here (D22). Every UI string, metadata title and
 * OG image reads it from this module so a rename is a one-line change.
 */
export const BRAND = {
  name: "STRATA",
  studio: "Aarambh Labs",
  headline: "Injective has the markets. STRATA brings the liquidity.",
  subhead:
    "AI market makers compete in the open, get scored onchain, and earn for every basis point of spread they remove.",
  concept: "Liquidity as terrain",
} as const;

export type Brand = typeof BRAND;
