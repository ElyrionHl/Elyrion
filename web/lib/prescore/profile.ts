import { MAX_TXS } from "./constants";
import type { Metrics } from "./metrics";
import type { Tier } from "./score";
import {
  AGENT_CLOSERS, CLOSERS, EMPTY_LINES, NO_HISTORY_OPENER, OPENERS, REGISTER_CLOSERS, TOKEN_ONLY_OPENERS, TRAIT_LINES,
} from "./templates";
import type { TraitId } from "./traits";

export const PROFILE_MAX_CHARS = 280;

const SLOT_RE = /\{(\w+)\}/g;
const fmt = new Intl.NumberFormat("en-US");
/** A count from a full 1,000-row window is a lower bound: "640+", "1,000+". */
const count = (n: number, windowFull: boolean) => (windowFull || n >= MAX_TXS ? `${fmt.format(Math.min(n, MAX_TXS))}+` : fmt.format(n));

/** Slot names used by a template, in order. */
export function slotsIn(template: string): string[] {
  return [...template.matchAll(SLOT_RE)].map((x) => x[1]);
}

function slotValue(slot: string, m: Metrics, tier: Tier): string | null {
  switch (slot) {
    case "firstBlock": return m.firstBlock === null ? null : fmt.format(m.firstBlock);
    case "ageDays": return fmt.format(m.ageDays);
    case "txCount": return count(m.txCount, m.windowFull);
    case "activeDays": return count(m.activeDays, m.windowFull);
    case "tokens": return count(m.distinctTokens, m.tokenWindowFull);
    case "contracts": return count(m.distinctContracts, m.windowFull);
    case "tier": return tier;
    default: return null;
  }
}

/** Fills `{slot}`s from data. A missing value renders as "—" (selection avoids that case; see `usable`). */
export function fillSlots(template: string, m: Metrics, tier: Tier): string {
  return template.replace(SLOT_RE, (_, slot: string) => slotValue(slot, m, tier) ?? "—");
}

/** Raw numbers behind numeric slots; a template is usable only if each is known and ≥ 2 (keeps plurals true). */
function usable(template: string, m: Metrics): boolean {
  return slotsIn(template).every((slot) => {
    switch (slot) {
      case "firstBlock": return m.firstBlock !== null;
      case "ageDays": return m.ageDays >= 2;
      case "txCount": return m.txCount >= 2;
      case "activeDays": return m.activeDays >= 2;
      case "tokens": return m.distinctTokens >= 2;
      case "contracts": return m.distinctContracts >= 2;
      case "tier": return true;
      default: return false;
    }
  });
}

/** FNV-1a (32-bit) over the normalised address. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG returning [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Image words that read as repetition when two sentences of one profile share them.
const MOTIFS = [
  "gate", "threshold", "path", "ledger", "oath", "dawn", "constellation", "fields", "footsteps", "summit", "ascent",
  "signature", "corners", "registry", "first light",
];
const motifsIn = (s: string) => MOTIFS.filter((w) => s.toLowerCase().includes(w));

/**
 * Picks one template: usable for the data, preferring ones that reuse no slot or motif already in the profile.
 * Always draws exactly one random number so later picks do not shift with the data.
 */
function pick(pool: string[], m: Metrics, rand: () => number, used: { slots: Set<string>; motifs: Set<string> }): string {
  const r = rand();
  const ok = pool.filter((s) => usable(s, m));
  const fresh = ok.filter((s) => !slotsIn(s).some((x) => used.slots.has(x)) && !motifsIn(s).some((x) => used.motifs.has(x)));
  const from = fresh.length ? fresh : ok.length ? ok : pool.filter((s) => slotsIn(s).length === 0);
  const chosen = from[Math.floor(r * from.length)];
  for (const s of slotsIn(chosen)) used.slots.add(s);
  for (const w of motifsIn(chosen)) used.motifs.add(w);
  return chosen;
}

export type ProfileOptions = {
  /** The address owns a registered agent: closers that urge registering one are left out. */
  hasAgent?: boolean;
};

/** Closer pool: without an agent every closer; with one, the neutral closers plus agent-aware ones. */
export function closersFor(hasAgent: boolean): string[] {
  return hasAgent ? [...CLOSERS.filter((c) => !REGISTER_CLOSERS.includes(c)), ...AGENT_CLOSERS] : CLOSERS;
}

/** What kind of record the metrics describe, which decides the opener pool. */
export function recordKind(m: Metrics): "empty" | "token-only" | "active" {
  if (m.firstTs !== null || m.firstBlock !== null || m.txCount > 0) return "active";
  return m.distinctTokens > 0 ? "token-only" : "empty";
}

/**
 * Deterministic profile text: 1 opener + lines for the first 1–2 traits + 1 closer, ≤ 280 chars.
 * The same address (any case, surrounding spaces ignored) always gets the same text for the same data.
 * No history at all: the no-history opener and an empty-record line. Token transfers but no transaction of its own
 * (txlist empty): a token-only opener instead of a tier opener, then the trait lines (no footsteps framing).
 */
export function buildProfile(address: string, tier: Tier, traits: TraitId[], m: Metrics, opts: ProfileOptions = {}): string {
  const rand = prng(fnv1a(address.trim().toLowerCase()));
  const used = { slots: new Set<string>(), motifs: new Set<string>() };
  const fill = (s: string) => fillSlots(s, m, tier);
  const closers = closersFor(!!opts.hasAgent);
  const kind = recordKind(m);

  if (kind === "empty") {
    used.motifs.add("footsteps");
    const line = pick(EMPTY_LINES, m, rand, used);
    const closer = pick(closers, m, rand, used);
    return [NO_HISTORY_OPENER, fill(line), fill(closer)].join(" ");
  }

  const opener = pick(kind === "token-only" ? TOKEN_ONLY_OPENERS : OPENERS[tier], m, rand, used);
  if (opener.includes(tier)) used.slots.add("tier"); // avoid "The Hero tier…" after a Hero opener
  const lines = traits.slice(0, 2).map((id) => pick(TRAIT_LINES[id], m, rand, used));
  const closer = pick(closers, m, rand, used);

  // Drop the second trait line, then the first, if the text would run long.
  for (let n = lines.length; n >= 0; n--) {
    const text = [opener, ...lines.slice(0, n), closer].map(fill).join(" ");
    if (text.length <= PROFILE_MAX_CHARS || n === 0) return text;
  }
  return fill(opener);
}
