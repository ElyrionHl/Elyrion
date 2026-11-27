import { describe, expect, it } from "vitest";
import { detectTraits, TRAIT_IDS, type TraitId } from "../../lib/prescore/traits";
import { LAUNCH_TS } from "../../lib/prescore/constants";
import type { Metrics } from "../../lib/prescore/metrics";

// A middling address: no trait fires.
const base: Metrics = {
  ageDays: 10, firstBlock: 1, firstTs: LAUNCH_TS + 10 * 86400, txCount: 10, windowFull: false, tokenWindowFull: false, activeDays: 3,
  distinctContracts: 3, distinctTokens: 2, usdcTransfers: 0, busiestDayShare: 0.5,
};

// Each fixture is the middling address plus one change.
const fixtures: Record<TraitId, Partial<Metrics>> = {
  "early-arrival": { firstTs: LAUNCH_TS + 86400 },
  veteran: { ageDays: 21 },
  newcomer: { ageDays: 2 },
  relentless: { txCount: 300 },
  steady: { ageDays: 10, activeDays: 7 },
  burst: { busiestDayShare: 0.8 },
  explorer: { distinctContracts: 10 },
  collector: { distinctTokens: 8 },
  focused: { distinctContracts: 2, txCount: 20 },
  "stable-native": { usdcTransfers: 5 },
  quiet: { txCount: 4 },
  "wide-reach": { distinctContracts: 9, distinctTokens: 7 },
  loyal: { activeDays: 14, ageDays: 40 },
};

describe("detectTraits", () => {
  it("has at least 12 traits, all covered by fixtures", () => {
    expect(TRAIT_IDS.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(fixtures).sort()).toEqual([...TRAIT_IDS].sort());
  });
  it("middling address has no traits", () => {
    expect(detectTraits(base)).toEqual([]);
  });
  for (const id of Object.keys(fixtures) as TraitId[]) {
    it(`reachable: ${id}`, () => {
      expect(detectTraits({ ...base, ...fixtures[id] })).toContain(id);
    });
  }
  it("threshold edges", () => {
    expect(detectTraits({ ...base, ageDays: 20 })).not.toContain("veteran");
    expect(detectTraits({ ...base, ageDays: 3 })).not.toContain("newcomer");
    expect(detectTraits({ ...base, txCount: 299 })).not.toContain("relentless");
    expect(detectTraits({ ...base, txCount: 5 })).not.toContain("quiet");
    expect(detectTraits({ ...base, firstTs: LAUNCH_TS + 3 * 86400 })).toContain("early-arrival");
    expect(detectTraits({ ...base, firstTs: LAUNCH_TS + 3 * 86400 + 1 })).not.toContain("early-arrival");
    expect(detectTraits({ ...base, usdcTransfers: 4 })).not.toContain("stable-native");
    expect(detectTraits({ ...base, busiestDayShare: 0.79 })).not.toContain("burst");
  });
  it("returns at most 3 distinct traits", () => {
    const m: Metrics = {
      ageDays: 25, firstBlock: 1, firstTs: LAUNCH_TS, txCount: 600, windowFull: false, tokenWindowFull: false, activeDays: 20,
      distinctContracts: 15, distinctTokens: 12, usdcTransfers: 40, busiestDayShare: 0.1,
    };
    const t = detectTraits(m);
    expect(t.length).toBe(3);
    expect(new Set(t).size).toBe(3);
  });
  it("an address with no history is quiet, never a newcomer", () => {
    const fresh: Metrics = {
      ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, windowFull: false, tokenWindowFull: false, activeDays: 0,
      distinctContracts: 0, distinctTokens: 0, usdcTransfers: 0, busiestDayShare: 0,
    };
    expect(detectTraits(fresh)).toEqual(["quiet"]);
  });
  it("a token-only address (tokens received, no tx of its own) gets no Newcomer chip", () => {
    const tokenOnly: Metrics = {
      ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, windowFull: false, tokenWindowFull: false, activeDays: 0,
      distinctContracts: 0, distinctTokens: 9, usdcTransfers: 6, busiestDayShare: 0,
    };
    const t = detectTraits(tokenOnly);
    expect(t).not.toContain("newcomer");
    expect(t).toEqual(expect.arrayContaining(["quiet", "collector", "stable-native"]));
    // A known first tx two days ago is still a newcomer.
    expect(detectTraits({ ...base, firstTs: LAUNCH_TS + 20 * 86400, ageDays: 2 })).toContain("newcomer");
    expect(detectTraits({ ...base, firstTs: null, ageDays: 0 })).not.toContain("newcomer");
  });
  it("a full 1,000-tx window suppresses Burst, Focused and Quiet (older activity is unseen)", () => {
    const burst = { ...base, ...fixtures.burst };
    const focused = { ...base, ...fixtures.focused };
    const quiet = { ...base, ...fixtures.quiet };
    for (const [id, m] of [["burst", burst], ["focused", focused], ["quiet", quiet]] as const) {
      expect(detectTraits(m), id).toContain(id);
      expect(detectTraits({ ...m, windowFull: true }), id).not.toContain(id);
      // The token window alone does not touch tx-based traits.
      expect(detectTraits({ ...m, tokenWindowFull: true }), id).toContain(id);
    }
    // Lower-bound traits stay.
    expect(detectTraits({ ...base, txCount: 1000, windowFull: true })).toContain("relentless");
    expect(detectTraits({ ...base, distinctContracts: 12, windowFull: true })).toContain("explorer");
  });
  it("is deterministic", () => {
    const m = { ...base, txCount: 400, distinctTokens: 9, ageDays: 22 };
    expect(detectTraits(m)).toEqual(detectTraits({ ...m }));
  });
});
