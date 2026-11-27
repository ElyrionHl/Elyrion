import { describe, expect, it } from "vitest";
import { buildProfile, closersFor, fillSlots, recordKind, slotsIn } from "../../lib/prescore/profile";
import {
  AGENT_CLOSERS, CLOSERS, EMPTY_LINES, NO_HISTORY_OPENER, OPENERS, REGISTER_CLOSERS, TOKEN_ONLY_OPENERS, TRAIT_LABELS, TRAIT_LINES,
} from "../../lib/prescore/templates";
import { detectTraits, TRAIT_IDS, type TraitId } from "../../lib/prescore/traits";
import { scoreMetrics } from "../../lib/prescore/score";
import type { Metrics } from "../../lib/prescore/metrics";
import type { Tier } from "../../lib/prescore/score";
import { LAUNCH_TS } from "../../lib/prescore/constants";

const TIERS: Tier[] = ["Wanderer", "Initiate", "Worthy", "Hero", "Immortal"];
const SLOTS = ["firstBlock", "ageDays", "txCount", "activeDays", "tokens", "contracts", "tier"];

const EMPTY: Metrics = {
  ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, windowFull: false, tokenWindowFull: false, activeDays: 0,
  distinctContracts: 0, distinctTokens: 0, usdcTransfers: 0, busiestDayShare: 0,
};
const LOW: Metrics = {
  ageDays: 2, firstBlock: 1, firstTs: LAUNCH_TS, txCount: 2, windowFull: false, tokenWindowFull: false, activeDays: 2,
  distinctContracts: 2, distinctTokens: 2, usdcTransfers: 0, busiestDayShare: 1,
};
const MID: Metrics = {
  ageDays: 18, firstBlock: 252101, firstTs: LAUNCH_TS, txCount: 140, windowFull: false, tokenWindowFull: false, activeDays: 9,
  distinctContracts: 12, distinctTokens: 6, usdcTransfers: 7, busiestDayShare: 0.4,
};
// Token transfers, but no transaction at all in txlist (sent or received).
const TOKEN_ONLY: Metrics = { ...EMPTY, distinctTokens: 9, usdcTransfers: 6 };
const MAX: Metrics = {
  ageDays: 99999, firstBlock: 999_999_999, firstTs: LAUNCH_TS, txCount: 1000, windowFull: true, tokenWindowFull: true, activeDays: 999,
  distinctContracts: 1000, distinctTokens: 1000, usdcTransfers: 1000, busiestDayShare: 1,
};

// Time/arrival framing that would contradict a Newcomer or Veteran line next to a tier-only opener.
const LONG_STANDING = /\b(long|far behind|well behind|knows [\w ]*well|well known|deep(ly)?|seasoned|old|ages|years|veteran|always|since long)\b/i;
const EARLY = /\b(early|arriv\w*|newly|new|fresh|young|begun|beginning|began|started|starts?|still|yet|so far|for now|taking form|forming|finding|first (marks?|rites|chapter|few|steps?|stars?)|ahead|to come)\b/i;
const TIME_WORDS = new RegExp(`${LONG_STANDING.source}|${EARLY.source}`, "i");

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
  ...AGENT_CLOSERS,
  ...TOKEN_ONLY_OPENERS,
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
    const pools = [...Object.values(OPENERS), ...Object.values(TRAIT_LINES), CLOSERS, closersFor(true), EMPTY_LINES, TOKEN_ONLY_OPENERS];
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
    expect(fillSlots("{txCount}", { ...MID, txCount: 1000, windowFull: true }, "Hero")).toBe("1,000+");
  });
  it("a full window shows every count from it as a lower bound (N+)", () => {
    const full: Metrics = { ...MID, windowFull: true };
    expect(fillSlots("{txCount} {activeDays} {contracts} {tokens}", full, "Hero")).toBe("140+ 9+ 12+ 6");
    expect(fillSlots("{tokens} {txCount}", { ...MID, tokenWindowFull: true }, "Hero")).toBe("6+ 140");
    expect(fillSlots("{ageDays} {firstBlock}", full, "Hero")).toBe("18 252,101"); // not window counts
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
  it("a token-only address gets a token-only opener, never the no-history text", () => {
    expect(recordKind(TOKEN_ONLY)).toBe("token-only");
    expect(recordKind(EMPTY)).toBe("empty");
    expect(recordKind(MID)).toBe("active");
    const traits = detectTraits(TOKEN_ONLY);
    expect(traits).not.toContain("newcomer");
    const tier = scoreMetrics(TOKEN_ONLY).tier;
    const openers = TOKEN_ONLY_OPENERS.map((o) => fillSlots(o, TOKEN_ONLY, tier));
    for (const a of addresses(80, 23)) {
      for (const hasAgent of [false, true]) {
        const p = buildProfile(a, tier, traits, TOKEN_ONLY, { hasAgent });
        expect(openers.some((o) => p.startsWith(o)), p).toBe(true);
        expect(p, p).not.toMatch(/No footsteps|nothing to weigh|holds no entries|record is blank|first step is still|first mark/i);
        expect(EMPTY_LINES.some((l) => p.includes(l)), p).toBe(false);
        expect(p.length).toBeLessThanOrEqual(280);
        expect(p, p).not.toMatch(/[{}—]/);
      }
    }
    // With one token the {tokens} opener is never chosen (plural stays true).
    const one: Metrics = { ...TOKEN_ONLY, distinctTokens: 1, usdcTransfers: 0 };
    for (const a of addresses(40, 29)) expect(buildProfile(a, "Wanderer", ["quiet"], one), a).not.toMatch(/\b1 kinds/);
  });

  it("token-only openers make no claim the data cannot back", () => {
    for (const o of TOKEN_ONLY_OPENERS) {
      expect(o, o).toMatch(/token/i);
      expect(o, o).not.toMatch(/\b(received|arrived|holds?|balance|footsteps?|newcomer|early|days?)\b/i);
    }
  });

  it("token-only openers never claim 'alone' or 'only' (internal transfers are not read) (F2)", () => {
    for (const o of TOKEN_ONLY_OPENERS) expect(o, o).not.toMatch(/(alone|only)/i);
    expect(TOKEN_ONLY_OPENERS).toContain("The ledger shows this address in token transfers, with no transaction of its own.");
  });

  it("a partial reading with no counted tx claims no empty history (F3)", () => {
    const partial = { partial: true };
    expect(recordKind(EMPTY, partial)).toBe("partial");
    expect(recordKind(EMPTY)).toBe("empty");
    expect(recordKind(MID, partial)).toBe("active");
    for (const a of addresses(40, 41)) {
      const p = buildProfile(a, "Wanderer", ["newcomer"], EMPTY, partial);
      expect(p.startsWith("Token history could not be read this time; no transaction of its own was found."), p).toBe(true);
      expect(p, p).not.toMatch(/No footsteps|nothing to weigh|holds no entries|record is blank|first step|first mark|gate is open|—|[{}]/i);
      expect(p.length).toBeLessThanOrEqual(280);
    }
  });

  it("an agent owner never gets a closer urging registration; others may", () => {
    expect(REGISTER_CLOSERS.every((c) => CLOSERS.includes(c))).toBe(true);
    const pool = closersFor(true);
    expect(pool.some((c) => REGISTER_CLOSERS.includes(c))).toBe(false);
    expect(AGENT_CLOSERS.every((c) => pool.includes(c))).toBe(true);
    for (const c of pool) expect(c, c).not.toMatch(/\bregister (an|your)\b|registry is open|must first be registered|begins with a registered agent/i);
    let agentCloser = 0;
    for (const tier of TIERS) {
      for (const m of [EMPTY, TOKEN_ONLY, LOW, MID, MAX]) {
        for (const a of addresses(30, 31)) {
          const p = buildProfile(a, tier, detectTraits(m), m, { hasAgent: true });
          expect(REGISTER_CLOSERS.some((c) => p.endsWith(fillSlots(c, m, tier))), p).toBe(false);
          if (AGENT_CLOSERS.some((c) => p.endsWith(c))) agentCloser++;
        }
      }
    }
    expect(agentCloser).toBeGreaterThan(0);
    // Without an agent the full pool stays in use.
    const seen = new Set(addresses(400, 37).map((a) => buildProfile(a, "Worthy", [], MID)));
    expect([...seen].some((p) => REGISTER_CLOSERS.some((c) => p.endsWith(c)))).toBe(true);
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
    // firstBlock is a large number so any standalone 0 or 1 in the text can only come from a bad fill.
    const thin: Metrics = { ...LOW, firstBlock: 52_000, txCount: 1, activeDays: 1, distinctContracts: 1, distinctTokens: 0, ageDays: 1 };
    const zero: Metrics = { ...thin, txCount: 0, activeDays: 0, distinctContracts: 0, ageDays: 0 };
    for (const tier of TIERS) {
      for (const m of [thin, zero]) {
        for (const a of addresses(80, 5)) {
          const p = buildProfile(a, tier, ["quiet", "newcomer"], m);
          expect(p, p).not.toMatch(/(?<![\d,])[01](?![\d,+])/);
        }
      }
    }
  });
  it("shows 1,000+ only for capped counts, and never a bare 1,000 for them", () => {
    const below: Metrics = { ...MID, txCount: 999, windowFull: false, tokenWindowFull: false, distinctContracts: 999, distinctTokens: 999, activeDays: 999 };
    const traits: TraitId[][] = [["relentless", "explorer"], ["collector", "wide-reach"], ["loyal", "steady"]];
    for (const tier of TIERS) {
      for (const t of traits) {
        for (const a of addresses(40, 13)) {
          expect(buildProfile(a, tier, t, below)).not.toMatch(/1,000\+/);
          expect(buildProfile(a, tier, t, below)).not.toMatch(/(?<![\d,])1(?![\d,+])/);
          const capped = buildProfile(a, tier, t, MAX);
          expect(capped, capped).not.toMatch(/1,000(?!\+)/);
        }
      }
    }
  });
  it("tier openers carry no time or arrival framing", () => {
    for (const t of TIERS) for (const s of OPENERS[t]) expect(TIME_WORDS.test(s), s).toBe(false);
  });
  it("no profile pairs a newcomer with a long-standing opener, or a veteran/early arrival with an early opener", () => {
    const young: Metrics = { ...MID, ageDays: 1, activeDays: 2 };
    const old: Metrics = { ...MID, ageDays: 25 };
    const cases: [TraitId, Metrics, RegExp][] = [
      ["newcomer", young, LONG_STANDING],
      ["veteran", old, EARLY],
      ["early-arrival", old, EARLY],
    ];
    for (const tier of TIERS) {
      for (const [trait, m, bad] of cases) {
        for (const other of TRAIT_IDS) {
          if (other === trait) continue;
          for (const a of addresses(12, 17)) {
            const p = buildProfile(a, tier, [trait, other], m);
            const opener = OPENERS[tier].map((s) => fillSlots(s, m, tier)).find((s) => p.startsWith(s));
            expect(opener, p).toBeDefined();
            expect(bad.test(opener!), p).toBe(false);
          }
        }
      }
    }
  });
  it("exhaustive combos stay ≤280 chars with no unresolved slots", () => {
    const seeds = addresses(4, 11);
    for (const tier of TIERS) {
      for (const t1 of TRAIT_IDS) {
        for (const t2 of TRAIT_IDS) {
          if (t1 === t2) continue;
          for (const m of [EMPTY, TOKEN_ONLY, LOW, MID, MAX]) {
            for (const a of seeds) {
              const p = buildProfile(a, tier, [t1, t2] as TraitId[], m, { hasAgent: a === seeds[0] });
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
    const opener = Math.max(...TIERS.map((t) => len(OPENERS[t])), len(TOKEN_ONLY_OPENERS));
    const line = Math.max(...TRAIT_IDS.map((id) => len(TRAIT_LINES[id])));
    expect(opener + 1 + line + 1 + Math.max(len(CLOSERS), len(AGENT_CLOSERS))).toBeLessThanOrEqual(280);
  });
  it("profile with no traits is opener + closer", () => {
    const p = buildProfile(addr, "Initiate", [], MID);
    expect(p.length).toBeGreaterThan(20);
    expect(p).not.toMatch(/[{}]/);
  });
});
