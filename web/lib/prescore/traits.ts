import { DAY_SEC, LAUNCH_TS, T } from "./constants";
import type { Metrics } from "./metrics";

export type TraitId =
  | "early-arrival" | "veteran" | "newcomer" | "relentless" | "steady" | "burst" | "explorer"
  | "collector" | "focused" | "stable-native" | "quiet" | "wide-reach" | "loyal";

/*
 * Trait thresholds (all from Metrics; constants in constants.ts `T`):
 *
 * early-arrival  firstTs within 3 days after mainnet launch (firstTs <= LAUNCH_TS + 3d; also within 3d before)
 * veteran        ageDays >= 21
 * newcomer       ageDays < 3 (includes no history)
 * relentless     txCount >= 300
 * steady         activeDays >= 7 and activeDays >= 50% of days since first tx (ageDays + 1)
 * burst          txCount >= 10 and busiestDayShare >= 0.8 (80%+ of txs on the 2 busiest days)
 * explorer       distinctContracts >= 10
 * collector      distinctTokens >= 8
 * focused        distinctContracts <= 2 and txCount >= 20
 * stable-native  usdcTransfers >= 5
 * quiet          txCount < 5
 * wide-reach     distinctTokens + distinctContracts >= 16
 * loyal          activeDays >= 14
 *
 * The brief's "builder-hours" is intentionally not used (time zones are unknown), so there are 13 traits.
 *
 * Strength is a 0..1 score per trait; results are sorted by strength desc, ties broken by the order below.
 */

const ratio = (v: number, t: number) => Math.min(1, v / t);

type Def = { id: TraitId; strength: (m: Metrics) => number | null };

const DEFS: Def[] = [
  {
    id: "newcomer",
    strength: (m) => (m.ageDays < T.newcomerDays ? 1 - m.ageDays / T.newcomerDays : null),
  },
  {
    id: "early-arrival",
    strength: (m) =>
      m.firstTs !== null && Math.abs(m.firstTs - LAUNCH_TS) <= T.earlyArrivalDays * DAY_SEC ? 0.95 : null,
  },
  { id: "veteran", strength: (m) => (m.ageDays >= T.veteranDays ? 0.6 + 0.4 * ratio(m.ageDays, 30) : null) },
  { id: "relentless", strength: (m) => (m.txCount >= T.relentlessTxs ? 0.7 + 0.3 * ratio(m.txCount, 1000) : null) },
  {
    id: "steady",
    strength: (m) =>
      m.activeDays >= T.steadyMinActiveDays && m.activeDays >= T.steadyMinShare * (m.ageDays + 1)
        ? 0.6 + 0.3 * ratio(m.activeDays, 14)
        : null,
  },
  { id: "burst", strength: (m) => (m.txCount >= T.burstMinTxs && m.busiestDayShare >= T.burstShare ? 0.55 + 0.3 * m.busiestDayShare : null) },
  { id: "explorer", strength: (m) => (m.distinctContracts >= T.explorerContracts ? 0.6 + 0.3 * ratio(m.distinctContracts, 25) : null) },
  { id: "collector", strength: (m) => (m.distinctTokens >= T.collectorTokens ? 0.6 + 0.3 * ratio(m.distinctTokens, 20) : null) },
  {
    id: "focused",
    strength: (m) => (m.distinctContracts <= T.focusedMaxContracts && m.txCount >= T.focusedMinTxs ? 0.5 + 0.3 * ratio(m.txCount, 200) : null),
  },
  { id: "stable-native", strength: (m) => (m.usdcTransfers >= T.stableNativeTransfers ? 0.55 + 0.3 * ratio(m.usdcTransfers, 50) : null) },
  { id: "quiet", strength: (m) => (m.txCount < T.quietTxs ? 1 - m.txCount / T.quietTxs : null) },
  {
    id: "wide-reach",
    strength: (m) => {
      const n = m.distinctTokens + m.distinctContracts;
      return n >= T.wideReachBreadth ? 0.5 + 0.3 * ratio(n, 40) : null;
    },
  },
  { id: "loyal", strength: (m) => (m.activeDays >= T.loyalActiveDays ? 0.5 + 0.3 * ratio(m.activeDays, 30) : null) },
];

export const TRAIT_IDS: readonly TraitId[] = DEFS.map((d) => d.id);

export function detectTraits(m: Metrics): TraitId[] {
  return DEFS.map((d, i) => ({ id: d.id, i, s: d.strength(m) }))
    .filter((x): x is { id: TraitId; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.id);
}
