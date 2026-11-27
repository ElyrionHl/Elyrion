import { describe, expect, it } from "vitest";
import { scoreMetrics, tierFor } from "../../lib/prescore/score";
import type { Metrics } from "../../lib/prescore/metrics";

const base: Metrics = {
  ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, windowFull: false, tokenWindowFull: false, activeDays: 0,
  distinctContracts: 0, distinctTokens: 0, usdcTransfers: 0, busiestDayShare: 0,
};

describe("scoreMetrics", () => {
  it("maxes at 1000", () => {
    const s = scoreMetrics({ ...base, ageDays: 30, txCount: 500, activeDays: 14, distinctTokens: 5, distinctContracts: 10 });
    expect(s).toEqual({ total: 1000, longevity: 300, activity: 300, consistency: 200, breadth: 200, tier: "Immortal" });
  });
  it("age only", () => {
    const s = scoreMetrics({ ...base, ageDays: 15 });
    expect(s.longevity).toBe(150);
    expect(s.total).toBe(150);
    expect(s.tier).toBe("Wanderer");
  });
  it("activity uses log scale", () => {
    expect(scoreMetrics({ ...base, txCount: 9 }).activity).toBe(111);
  });
  it("no history is 0", () => {
    expect(scoreMetrics(base).total).toBe(0);
  });
  it("clamps above maxima", () => {
    const s = scoreMetrics({ ...base, ageDays: 400, txCount: 1000, activeDays: 90, distinctTokens: 50 });
    expect(s.total).toBe(1000);
  });
  it("rounds each part down", () => {
    const s = scoreMetrics({ ...base, ageDays: 1, activeDays: 1, distinctTokens: 1 });
    expect(s.longevity).toBe(10);
    expect(s.consistency).toBe(14);
    expect(s.breadth).toBe(13);
    expect(s.total).toBe(37);
  });
});

describe("tierFor", () => {
  it.each([
    [0, "Wanderer"], [199, "Wanderer"], [200, "Initiate"], [399, "Initiate"], [400, "Worthy"],
    [599, "Worthy"], [600, "Hero"], [799, "Hero"], [800, "Immortal"], [1000, "Immortal"],
  ])("%i -> %s", (n, t) => expect(tierFor(n)).toBe(t));
});
