// Single source of truth for Pre-Score tunables. Published on the Docs page.

/** Elysium mainnet launch, 2026-11-09T13:00:00Z (unix seconds). */
export const LAUNCH_TS = 1794229200;
export const DAY_SEC = 86400;

/** Explorer fetch window and txCount cap. */
export const MAX_TXS = 1000;

/** USDC on Elysium (verified on chain 2026-11-27). */
export const USDC_ADDRESS = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";

/** Score part maxima and saturation points. */
export const LONGEVITY_MAX = 300;
export const LONGEVITY_FULL_DAYS = 30;
export const ACTIVITY_MAX = 300;
export const ACTIVITY_FULL_TXS = 500; // log10(1 + tx) / log10(1 + 500)
export const CONSISTENCY_MAX = 200;
export const CONSISTENCY_FULL_DAYS = 14;
export const BREADTH_MAX = 200;
export const BREADTH_FULL_COUNT = 15; // distinctTokens + distinctContracts

/** Tier lower bounds (inclusive), ascending. */
export const TIER_BOUNDS = [
  { min: 800, tier: "Immortal" },
  { min: 600, tier: "Hero" },
  { min: 400, tier: "Worthy" },
  { min: 200, tier: "Initiate" },
  { min: 0, tier: "Wanderer" },
] as const;

/** Trait thresholds (see traits.ts for the table). */
export const T = {
  earlyArrivalDays: 3,
  veteranDays: 21,
  newcomerDays: 3, // ageDays < 3
  relentlessTxs: 300,
  steadyMinActiveDays: 7,
  steadyMinShare: 0.5,
  burstMinTxs: 10,
  burstShare: 0.8,
  explorerContracts: 10,
  collectorTokens: 8,
  focusedMaxContracts: 2,
  focusedMinTxs: 20,
  stableNativeTransfers: 5,
  quietTxs: 5, // txCount < 5
  wideReachBreadth: 16,
  loyalActiveDays: 14,
} as const;

/** Exact disclaimer shown on the page, the card and the OG image. */
export const DISCLAIMER = "Pre-Score · activity-based · not a credit score";
