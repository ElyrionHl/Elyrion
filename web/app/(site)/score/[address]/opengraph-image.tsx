import { headers } from "next/headers";
import { OG_SIZE } from "@/lib/prescore/og-card";
import { preScoreCardResponse } from "@/lib/prescore/og-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Elysium Pre-Score card";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Request origin, for the site URL on the card when NEXT_PUBLIC_SITE_URL is unset. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) return "";
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  let raw = address;
  try {
    raw = decodeURIComponent(address);
  } catch {
    // keep the raw segment; an invalid address renders the generic card
  }
  return preScoreCardResponse(raw, await requestOrigin());
}
