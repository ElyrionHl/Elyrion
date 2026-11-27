// Pure view helpers for the Pre-Score pages, share card and OG image. No React, no I/O: unit-tested.
import { ACTIVITY_MAX, BREADTH_MAX, CONSISTENCY_MAX, LONGEVITY_MAX, MAX_TXS } from "./constants";
import type { Metrics } from "./metrics";
import type { ScoreBreakdown } from "./score";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Checksum-insensitive: trims, accepts any case, returns the lowercased address or null. */
export function parseAddressInput(input: string): `0x${string}` | null {
  const s = String(input ?? "").trim();
  return ADDRESS_RE.test(s) ? (s.toLowerCase() as `0x${string}`) : null;
}

/** Inline validation message for the search field; null while the value is empty or valid. */
export function addressInputError(input: string): string | null {
  const s = String(input ?? "").trim();
  if (!s || parseAddressInput(s)) return null;
  if (!/^0x/i.test(s)) return "An Elysium address starts with 0x.";
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return "Only 0–9 and a–f may follow 0x.";
  return `An address is 0x followed by 40 characters — this one has ${s.length - 2}.`;
}

/** "1,234" (en-US grouping). */
export const fmt = (n: number) => Math.max(0, Math.floor(n)).toLocaleString("en-US");

/** The tx count as shown everywhere: "1,000+" when the fetch window was full. */
export function txCountLabel(m: Pick<Metrics, "txCount" | "txCapped">): string {
  return m.txCapped ? `${fmt(MAX_TXS)}+` : fmt(m.txCount);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The three mono lines of the reading sequence, built only from real numbers. */
export function readingLines(m: Metrics): [string, string, string] {
  return [
    `READING ${txCountLabel(m)} ${plural(m.txCount, "TRANSACTION", "TRANSACTIONS")}`,
    m.firstBlock !== null ? `FIRST FOOTSTEP · BLOCK ${fmt(m.firstBlock)}` : "NO FOOTSTEPS YET",
    `WEIGHING ${fmt(m.distinctTokens)} ${plural(m.distinctTokens, "TOKEN", "TOKENS")}`,
  ];
}

/**
 * A result computed more than this long ago came from a cache: skip the reading sequence and go straight to
 * the reveal. `computedAt` is server time and `now` client time, so small clock skew either way still counts as fresh.
 */
export const FRESH_MS = 10_000;
export const isFresh = (computedAt: number, now: number) => Math.abs(now - computedAt) <= FRESH_MS;

export type BreakdownRow = { key: "longevity" | "activity" | "consistency" | "breadth"; label: string; points: number; max: number; detail: string };

export function breakdownRows(s: ScoreBreakdown, m: Metrics): BreakdownRow[] {
  return [
    {
      key: "longevity",
      label: "Longevity",
      points: s.longevity,
      max: LONGEVITY_MAX,
      detail: m.firstTs === null ? "No first transaction yet" : `${fmt(m.ageDays)} ${plural(m.ageDays, "day", "days")} since the first footstep`,
    },
    {
      key: "activity",
      label: "Activity",
      points: s.activity,
      max: ACTIVITY_MAX,
      detail: `${txCountLabel(m)} successful ${plural(m.txCount, "transaction", "transactions")} sent`,
    },
    {
      key: "consistency",
      label: "Consistency",
      points: s.consistency,
      max: CONSISTENCY_MAX,
      detail: `${fmt(m.activeDays)} active ${plural(m.activeDays, "day", "days")} (UTC)`,
    },
    {
      key: "breadth",
      label: "Breadth",
      points: s.breadth,
      max: BREADTH_MAX,
      detail: `${fmt(m.distinctTokens)} ${plural(m.distinctTokens, "token", "tokens")} · ${fmt(m.distinctContracts)} ${plural(m.distinctContracts, "contract", "contracts")}`,
    },
  ];
}

/** Share text for X. */
export function shareText(total: number, tier: string): string {
  return `My Elysium Pre-Score is ${total} — ${tier}. Only the worthy enter Elysium.`;
}

/** Origin without trailing slash; "" when unusable. */
export function cleanOrigin(url: string | undefined | null): string {
  const s = String(url ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/i.test(s) ? s : "";
}

export function scoreUrl(origin: string, address: string): string {
  return `${cleanOrigin(origin)}/score/${address.toLowerCase()}`;
}

/** X post intent. Without an absolute `url` (no site origin known yet) it still works, with the text alone. */
export function xIntentUrl(text: string, url?: string): string {
  const base = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  return /^https?:\/\//i.test(url ?? "") ? `${base}&url=${encodeURIComponent(url!)}` : base;
}

/** "elyrion-prescore-0x0729-97f7.png" (no ellipsis in file names). */
export function pngFilename(address: string): string {
  const a = address.toLowerCase();
  return `elyrion-prescore-${a.slice(0, 6)}-${a.slice(-4)}.png`;
}

/** "elyrion.xyz" from "https://elyrion.xyz". */
export const displayHost = (origin: string) => cleanOrigin(origin).replace(/^https?:\/\//i, "");
