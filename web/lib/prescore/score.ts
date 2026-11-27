import {
  ACTIVITY_FULL_TXS, ACTIVITY_MAX, BREADTH_FULL_COUNT, BREADTH_MAX, CONSISTENCY_FULL_DAYS, CONSISTENCY_MAX,
  LONGEVITY_FULL_DAYS, LONGEVITY_MAX, TIER_BOUNDS,
} from "./constants";
import type { Metrics } from "./metrics";

export type Tier = "Wanderer" | "Initiate" | "Worthy" | "Hero" | "Immortal";
export type ScoreBreakdown = { total: number; longevity: number; activity: number; consistency: number; breadth: number; tier: Tier };

// Tiny epsilon guards against float error (e.g. 0.29999999 * 100) before flooring.
const part = (max: number, ratio: number) => Math.floor(max * Math.min(1, Math.max(0, ratio)) + 1e-9);

export function tierFor(total: number): Tier {
  return TIER_BOUNDS.find((b) => total >= b.min)?.tier ?? "Wanderer";
}

export function scoreMetrics(m: Metrics): ScoreBreakdown {
  const longevity = part(LONGEVITY_MAX, m.ageDays / LONGEVITY_FULL_DAYS);
  const activity = part(ACTIVITY_MAX, Math.log10(1 + m.txCount) / Math.log10(1 + ACTIVITY_FULL_TXS));
  const consistency = part(CONSISTENCY_MAX, m.activeDays / CONSISTENCY_FULL_DAYS);
  const breadth = part(BREADTH_MAX, (m.distinctTokens + m.distinctContracts) / BREADTH_FULL_COUNT);
  const total = longevity + activity + consistency + breadth;
  return { total, longevity, activity, consistency, breadth, tier: tierFor(total) };
}
