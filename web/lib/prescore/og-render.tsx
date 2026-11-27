import { ImageResponse } from "next/og";
import { cardModel, VARIANT_HEADER, type CardModel } from "./card";
import { CACHE_OG_FAIL, cacheControlFor } from "./http";
import { OG_SIZE, OgCard, type OgFonts } from "./og-card";
import { getOgFonts, type OgFont } from "./og-fonts";
import { DEADLINE_OG_MS } from "./constants";
import { getPreScore, type PreScoreResult } from "./service";
import { cleanOrigin, displayHost } from "./view";

const FAMILIES: OgFonts = { serif: "Instrument Serif", mono: "JetBrains Mono" };

async function png(model: CardModel, host: string, fonts: OgFont[] | null): Promise<ArrayBuffer> {
  const res = new ImageResponse(<OgCard model={model} host={host} fonts={fonts ? FAMILIES : undefined} />, {
    ...OG_SIZE,
    ...(fonts ? { fonts } : {}),
  });
  // Rendering happens inside the response stream; read it here so a failure can still fall back.
  return res.arrayBuffer();
}

export type OgDeps = { load?: (address: string) => Promise<PreScoreResult>; fonts?: () => Promise<OgFont[] | null> };

/**
 * The Pre-Score card as a PNG response. Never throws on explorer failure: any failed lookup renders the
 * generic "Check your Elysium Pre-Score" card with a 60 s CDN TTL. A degraded card (brand fonts missing, so
 * the bundled sans was used, or a fallback render) also gets the 60 s failure TTL, so the CDN does not keep
 * it for 5+ minutes once the fonts are back. The lookup gets DEADLINE_OG_MS (crawlers give up early); a slower
 * explorer yields the generic card while the shared lookup finishes and fills the cache.
 */
export async function preScoreCardResponse(address: string, requestOrigin: string, deps: OgDeps = {}): Promise<Response> {
  let result: PreScoreResult;
  try {
    result = await (deps.load ?? ((a: string) => getPreScore(a, { deadlineMs: DEADLINE_OG_MS })))(address);
  } catch {
    result = { ok: false, address: "", reason: "explorer" };
  }
  const model = cardModel(result);
  const host = displayHost(model.siteUrl || cleanOrigin(requestOrigin));
  const fonts = await (deps.fonts ?? (() => getOgFonts()))().catch(() => null);

  let body: ArrayBuffer;
  let variant = model.variant;
  let degraded = !fonts;
  try {
    body = await png(model, host, fonts);
  } catch {
    degraded = true;
    try {
      body = await png(model, host, null);
    } catch {
      variant = "generic";
      body = await png({ ...model, variant, shortAddress: "", traits: [], partial: false }, host, null);
    }
  }
  const cache = degraded ? CACHE_OG_FAIL : cacheControlFor(result, CACHE_OG_FAIL);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": cache, [VARIANT_HEADER]: variant },
  });
}
