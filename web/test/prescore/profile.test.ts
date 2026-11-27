import { describe, expect, it } from "vitest";
import { buildProfile, fillSlots, slotsIn } from "../../lib/prescore/profile";
import { CLOSERS, EMPTY_LINES, NO_HISTORY_OPENER, OPENERS, TRAIT_LABELS, TRAIT_LINES } from "../../lib/prescore/templates";
import { TRAIT_IDS, type TraitId } from "../../lib/prescore/traits";
import type { Metrics } from "../../lib/prescore/metrics";
import type { Tier } from "../../lib/prescore/score";
import { LAUNCH_TS } from "../../lib/prescore/constants";

const TIERS: Tier[] = ["Wanderer", "Initiate", "Worthy", "Hero", "Immortal"];
const SLOTS = ["firstBlock", "ageDays", "txCount", "activeDays", "tokens", "contracts", "tier"];

const EMPTY: Metrics = {
  ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, txCapped: false, activeDays: 0,
  distinctContracts: 0, distinctTokens: 0, usdcTransfers: 0, busiestDayShare: 0,
};
const LOW: Metrics = {
  ageDays: 2, firstBlock: 1, firstTs: LAUNCH_TS, txCount: 2, txCapped: false, activeDays: 2,
  distinctContracts: 2, distinctTokens: 2, usdcTransfers: 0, busiestDayShare: 1,
};
const MID: Metrics = {
  ageDays: 18, firstBlock: 252101, firstTs: LAUNCH_TS, txCount: 140, txCapped: false, activeDays: 9,
  distinctContracts: 12, distinctTokens: 6, usdcTransfers: 7, busiestDayShare: 0.4,
};
const MAX: Metrics = {
  ageDays: 99999, firstBlock: 999_999_999, firstTs: LAUNCH_TS, txCount: 1000, txCapped: true, activeDays: 999,
  distinctContracts: 1000, distinctTokens: 1000, usdcTransfers: 1000, busiestDayShare: 1,
};

// Deterministic pseudo-random addresses for variety tests.
function addresses(n: number, seed = 7): string[] {
  let s = seed;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let hex = "";
    for (let j = 0; j < 40; j++) {
      s = (s * 1103515245 + 12345) >>> 0;
      hex += ((s >>> 16) & 15).toString(16);
    }
    out.push("0x" + hex);
  }
  return out;
}

const allTemplates = (): string[] => [
  ...Object.values(OPENERS).flat(),
  ...Object.values(TRAIT_LINES).flat(),
  ...CLOSERS,
  ...EMPTY_LINES,
  NO_HISTORY_OPENER,
  ...Object.values(TRAIT_LABELS),
];

describe("template counts", () => {
  it("has ≥8 openers per tier", () => {
    for (const t of TIERS) expect(OPENERS[t].length, t).toBeGreaterThanOrEqual(8);
  });
  it("has ≥4 lines and a label for every trait", () => {
    for (const id of TRAIT_IDS) {
      expect(TRAIT_LINES[id].length, id).toBeGreaterThanOrEqual(4);
      expect(TRAIT_LABELS[id], id).toMatch(/^[A-Z]/);
    }
  });
  it("has ≥10 closers", () => {
    expect(CLOSERS.length).toBeGreaterThanOrEqual(10);
  });
  it("has no duplicate templates", () => {
    const all = allTemplates();
    expect(new Set(all).size).toBe(all.length);
  });
  it("every pool keeps at least one slot-free template as a fallback", () => {
    const pools = [...Object.values(OPENERS), ...Object.values(TRAIT_LINES), CLOSERS, EMPTY_LINES];
    for (const p of pools) expect(p.some((s) => slotsIn(s).length === 0)).toBe(true);
  });
  it("uses only known slots", () => {
    for (const s of allTemplates()) for (const slot of slotsIn(s)) expect(SLOTS, s).toContain(slot);
  });
});

describe("banned words", () => {
  const banned = [
    /\bAI\b/, /\bTVL\b/i, /\bAPY\b/i, /guaranteed/i, /(?<!un)audited/i, /scam/i, /\bbots?\b/i, /\bdump/i, /\bpump/i,
    /profit/i, /\bprice/i, /\bmoon/i, /\binvest/i, /\byield/i, /financial/i, /\bwhale/i, /\bfarm/i, /sybil/i,
    /airdrop/i, /\bloan/i, /\bborrow/i, /official/i, /!/, /—/,
  ];
  it("no template contains banned words, exclamation marks, em dashes or emoji", () => {
    for (const s of allTemplates()) {
      for (const re of banned) expect(re.test(s), `${re} in "${s}"`).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(s), s).toBe(false);
    }
  });
  it("every template is a full sentence ending in a period", () => {
    const sentences = allTemplates().filter((s) => !Object.values(TRAIT_LABELS).includes(s));
    for (const s of sentences) expect(s, s).toMatch(/\.$/);
  });
});

describe("fillSlots", () => {
  it("fills every slot with en-US grouping", () => {
    const out = fillSlots("{firstBlock} {ageDays} {txCount} {activeDays} {tokens} {contracts} {tier}", MID, "Hero");
    expect(out).toBe("252,101 18 140 9 6 12 Hero");
  });
  it("shows capped counts as 1,000+", () => {
    expect(fillSlots("{txCount} {tokens} {contracts}", MAX, "Immortal")).toBe("1,000+ 1,000+ 1,000+");
    expect(fillSlots("{txCount}", { ...MID, txCount: 1000, txCapped: true }, "Hero")).toBe("1,000+");
  });
  it("shows a dash for a missing first block", () => {
    expect(fillSlots("{firstBlock}", EMPTY, "Wanderer")).toBe("—");
  });
});

describe("buildProfile", () => {
  const addr = "0x52908400098527886E0F7030069857D2E4169EE7";

  it("is deterministic", () => {
    const a = buildProfile(addr, "Hero", ["explorer", "loyal"], MID);
    expect(buildProfile(addr, "Hero", ["explorer", "loyal"], MID)).toBe(a);
  });
  it("normalises address case and whitespace", () => {
    const a = buildProfile(addr, "Worthy", ["explorer"], MID);
    expect(buildProfile(`  ${addr.toLowerCase()} `, "Worthy", ["explorer"], MID)).toBe(a);
  });
  it("different addresses give different text ≥80% of the time", () => {
    const xs = addresses(50, 7);
    const ys = addresses(50, 991);
    let differ = 0;
    for (let i = 0; i < 50; i++) {
      if (buildProfile(xs[i], "Worthy", ["explorer", "collector"], MID) !== buildProfile(ys[i], "Worthy", ["explorer", "collector"], MID)) differ++;
    }
    expect(differ).toBeGreaterThanOrEqual(40);
  });
  it("uses 1 opener, lines for the first 1–2 traits, and 1 closer", () => {
    const p = buildProfile(addr, "Worthy", ["explorer", "collector", "loyal"], MID);
    const filled = (pool: string[]) => pool.map((s) => fillSlots(s, MID, "Worthy"));
    expect(filled(OPENERS.Worthy).some((s) => p.startsWith(s))).toBe(true);
    expect(filled(CLOSERS).some((s) => p.endsWith(s))).toBe(true);
    expect(filled(TRAIT_LINES.explorer).some((s) => p.includes(s))).toBe(true);
    expect(filled(TRAIT_LINES.loyal).some((s) => p.includes(s))).toBe(false);
  });
  it("no history reads 'No footsteps on Elysium yet.' and never uses {firstBlock}", () => {
    for (const a of addresses(60)) {
      const p = buildProfile(a, "Wanderer", ["newcomer", "quiet"], EMPTY);
      expect(p.startsWith("No footsteps on Elysium yet.")).toBe(true);
      expect(p).not.toMatch(/block|—|\{|\}/i);
    }
  });
  it("never picks a {firstBlock} template when firstBlock is null", () => {
    const partial: Metrics = { ...MID, firstBlock: null };
    for (const tier of TIERS) {
      for (const a of addresses(80, 3)) {
        const p = buildProfile(a, tier, ["early-arrival", "veteran"], partial);
        expect(p, p).not.toMatch(/—|\{|\}/);
      }
    }
  });
  it("never fills a numeric slot with 0 or 1", () => {
    const thin: Metrics = { ...LOW, txCount: 1, activeDays: 1, distinctContracts: 1, distinctTokens: 0, ageDays: 1 };
    for (const tier of TIERS) {
      for (const a of addresses(80, 5)) {
        const p = buildProfile(a, tier, ["quiet", "newcomer"], thin);
        expect(p, p).not.toMatch(/(^|\s)[01] [a-z]/);
      }
    }
  });
  it("exhaustive combos stay ≤280 chars with no unresolved slots", () => {
    const seeds = addresses(4, 11);
    for (const tier of TIERS) {
      for (const t1 of TRAIT_IDS) {
        for (const t2 of TRAIT_IDS) {
          if (t1 === t2) continue;
          for (const m of [EMPTY, LOW, MID, MAX]) {
            for (const a of seeds) {
              const p = buildProfile(a, tier, [t1, t2] as TraitId[], m);
              expect(p.length, p).toBeLessThanOrEqual(280);
              expect(p, p).not.toMatch(/[{}]/);
              expect(p, p).not.toMatch(/\s{2}|^\s|\s$/);
            }
          }
        }
      }
    }
  });
  it("every opener + any trait line + any closer fits in 280 chars at max values", () => {
    const len = (pool: string[]) => Math.max(...pool.map((s) => fillSlots(s, MAX, "Immortal").length));
    const opener = Math.max(...TIERS.map((t) => len(OPENERS[t])));
    const line = Math.max(...TRAIT_IDS.map((id) => len(TRAIT_LINES[id])));
    expect(opener + 1 + line + 1 + len(CLOSERS)).toBeLessThanOrEqual(280);
  });
  it("profile with no traits is opener + closer", () => {
    const p = buildProfile(addr, "Initiate", [], MID);
    expect(p.length).toBeGreaterThan(20);
    expect(p).not.toMatch(/[{}]/);
  });
});
