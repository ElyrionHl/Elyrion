import { ImageResponse } from "next/og";
import { cardModel, type CardModel } from "./card";
import { CACHE_OG_FAIL, cacheControlFor } from "./http";
import { OG_SIZE, OgCard, type OgFonts } from "./og-card";
import { getOgFonts, type OgFont } from "./og-fonts";
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
 * generic "Check your Elysium Pre-Score" card with a 60 s CDN TTL; a font problem falls back to the bundled sans.
 */
export async function preScoreCardResponse(address: string, requestOrigin: string, deps: OgDeps = {}): Promise<Response> {
  let result: PreScoreResult;
  try {
    result = await (deps.load ?? getPreScore)(address);
  } catch {
    result = { ok: false, address: "", reason: "explorer" };
  }
  const model = cardModel(result);
  const host = displayHost(model.siteUrl || cleanOrigin(requestOrigin));
  const fonts = await (deps.fonts ?? getOgFonts)().catch(() => null);

  let body: ArrayBuffer;
  let cache = cacheControlFor(result, CACHE_OG_FAIL);
  try {
    body = await png(model, host, fonts);
  } catch {
    try {
      body = await png(model, host, null);
    } catch {
      body = await png({ ...model, variant: "generic", shortAddress: "", traits: [] }, host, null);
      cache = CACHE_OG_FAIL;
    }
  }
  return new Response(body, { status: 200, headers: { "content-type": "image/png", "cache-control": cache } });
}
