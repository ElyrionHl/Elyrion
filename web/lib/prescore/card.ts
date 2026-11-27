import { DISCLAIMER } from "./constants";
import type { PreScoreResult } from "./service";

/** Response header on the card PNG naming the card actually drawn ("score" | "contract" | "generic"). */
export const VARIANT_HEADER = "x-prescore-variant";

/** Label shown on the card, the OG image and the page description for a partial result. */
export const PARTIAL_LABEL = "PARTIAL READING";

export type CardModel = {
  variant: "score" | "generic" | "contract";
  shortAddress: string;
  total: number;
  tier: string;
  traits: string[];
  /** Token transfers could not be read: the card says "PARTIAL READING". */
  partial: boolean;
  disclaimer: string;
  siteUrl: string;
};

const short = (a: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Pure view-model for the share card / OG image. Any failure yields the generic card. */
export function cardModel(r: PreScoreResult): CardModel {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const base = { shortAddress: short(r.address), total: 0, tier: "", traits: [] as string[], partial: false, disclaimer: DISCLAIMER, siteUrl };
  if (!r.ok) return { ...base, variant: "generic", shortAddress: "" };
  if (r.kind === "contract") return { ...base, variant: "contract" };
  return {
    ...base,
    variant: "score",
    total: r.score.total,
    tier: r.score.tier,
    traits: r.traits.slice(0, 3).map((t) => t.label),
    partial: r.partial,
  };
}
