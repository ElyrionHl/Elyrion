import { DISCLAIMER } from "./constants";
import type { PreScoreResult } from "./service";

export type CardModel = {
  variant: "score" | "generic" | "contract";
  shortAddress: string;
  total: number;
  tier: string;
  traits: string[];
  disclaimer: string;
  siteUrl: string;
};

const short = (a: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Pure view-model for the share card / OG image. Any failure yields the generic card. */
export function cardModel(r: PreScoreResult): CardModel {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const base = { shortAddress: short(r.address), total: 0, tier: "", traits: [] as string[], disclaimer: DISCLAIMER, siteUrl };
  if (!r.ok) return { ...base, variant: "generic", shortAddress: "" };
  if (r.kind === "contract") return { ...base, variant: "contract" };
  return { ...base, variant: "score", total: r.score.total, tier: r.score.tier, traits: r.traits.slice(0, 3).map((t) => t.label) };
}
