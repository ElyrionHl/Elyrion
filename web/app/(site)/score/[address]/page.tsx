import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ContractNotice } from "@/components/prescore/ContractNotice";
import { ScoreReveal } from "@/components/prescore/ScoreReveal";
import { ScoreUnavailable } from "@/components/prescore/ScoreUnavailable";
import { shortAddr } from "@/lib/format";
import { PARTIAL_LABEL } from "@/lib/prescore/card";
import { DEADLINE_OG_MS, DEADLINE_PAGE_MS, DISCLAIMER } from "@/lib/prescore/constants";
import { getPreScore } from "@/lib/prescore/service";
import { cleanOrigin, parseAddressInput } from "@/lib/prescore/view";

/*
 * Rendered per request (the route reads params and the lookup is uncached by Next). Repeat visits are served from
 * the service's in-memory cache (5 min; 60 s partial; 15 s failures), not from a route-level revalidate.
 *
 * One lookup per request for each budget. generateMetadata gets the shorter OG budget (crawlers give up early);
 * both share the service's in-flight lookup, so the explorer is asked once.
 */
const loadPage = cache((address: string) => getPreScore(address, { deadlineMs: DEADLINE_PAGE_MS }));
const loadMeta = cache((address: string) => getPreScore(address, { deadlineMs: DEADLINE_OG_MS }));

/** Per-address result pages are shareable, not indexable. */
const ROBOTS: Metadata["robots"] = { index: false };

function addressFrom(raw: string): `0x${string}` | null {
  try {
    return parseAddressInput(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/score/[address]">): Promise<Metadata> {
  const address = addressFrom((await params).address);
  if (!address) return { robots: ROBOTS };
  const site = cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const short = shortAddr(address);
  const r = await loadMeta(address);
  const description =
    r.ok && r.kind === "wallet"
      ? `${r.score.tier} · ${r.score.total} / 1000${r.partial ? ` · ${PARTIAL_LABEL.toLowerCase()}` : ""}. ${DISCLAIMER}.`
      : r.ok
        ? "Pre-Score is for wallets. This address is a contract on Elysium."
        : "Check your Elysium Pre-Score: an activity-based reading from 0 to 1000.";
  const title = `Pre-Score ${short}`;
  return {
    title,
    description,
    robots: ROBOTS,
    ...(site ? { metadataBase: new URL(site) } : {}),
    alternates: { canonical: `/score/${address}` },
    openGraph: { title: `${title} · Elyrion`, description, url: `/score/${address}`, siteName: "Elyrion", type: "website" },
    twitter: { card: "summary_large_image", title: `${title} · Elyrion`, description },
  };
}

export default async function PreScorePage({ params }: PageProps<"/score/[address]">) {
  // layout.tsx already 404s invalid input and redirects mixed case to the lowercase URL.
  const address = addressFrom((await params).address);
  if (!address) notFound();

  const result = await loadPage(address);
  if (!result.ok) {
    if (result.reason === "invalid") notFound();
    return <ScoreUnavailable address={address} reason={result.reason} />;
  }
  if (result.kind === "contract") return <ContractNotice address={address} />;
  return <ScoreReveal result={result} />;
}
