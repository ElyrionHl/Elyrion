import { preScoreCardResponse } from "@/lib/prescore/og-render";
import { cleanOrigin } from "@/lib/prescore/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stable alias for the card PNG at /score/<address>/opengraph-image (used by "Download PNG").
 * The file-convention route next to this folder (../opengraph-image.tsx) is what og:image points at, but
 * inside the (site) route group Next serves it under a hashed name (opengraph-image-<hash>). Same renderer,
 * same cache headers.
 */
export async function GET(req: Request, ctx: RouteContext<"/score/[address]/opengraph-image">): Promise<Response> {
  const { address } = await ctx.params;
  let raw = address;
  try {
    raw = decodeURIComponent(address);
  } catch {
    // an undecodable segment renders the generic card
  }
  return preScoreCardResponse(raw, cleanOrigin(new URL(req.url).origin));
}
