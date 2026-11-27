import type { PreScoreResult } from "./service";

export const CACHE_OK = "public, s-maxage=300, stale-while-revalidate=600";
/** A wallet result built without token transfers: retried sooner (matches the service's 60 s TTL). */
export const CACHE_PARTIAL = "public, s-maxage=60, stale-while-revalidate=120";
export const CACHE_API_FAIL = "public, s-maxage=30";
export const CACHE_OG_FAIL = "public, s-maxage=60";

/** CDN Cache-Control for a Pre-Score response. `onFail` differs per route (API 30 s, OG generic card 60 s). */
export function cacheControlFor(r: PreScoreResult, onFail: string): string {
  if (!r.ok) return onFail;
  if (r.kind === "wallet" && r.partial) return CACHE_PARTIAL;
  return CACHE_OK;
}
