import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ContractNotice } from "@/components/prescore/ContractNotice";
import { ScoreReveal } from "@/components/prescore/ScoreReveal";
import { ScoreUnavailable } from "@/components/prescore/ScoreUnavailable";
import { shortAddr } from "@/lib/format";
import { DISCLAIMER } from "@/lib/prescore/constants";
import { getPreScore } from "@/lib/prescore/service";
import { cleanOrigin, parseAddressInput } from "@/lib/prescore/view";

/** Same TTL as the service cache and the API's CDN cache. */
export const revalidate = 300;

/** One lookup per request, shared by generateMetadata and the page. */
const load = cache((address: string) => getPreScore(address));

function addressFrom(raw: string): `0x${string}` | null {
  try {
    return parseAddressInput(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/score/[address]">): Promise<Metadata> {
  const address = addressFrom((await params).address);
  if (!address) return {};
  const site = cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const short = shortAddr(address);
  const r = await load(address);
  const description =
    r.ok && r.kind === "wallet"
      ? `${r.score.tier} · ${r.score.total} / 1000. ${DISCLAIMER}.`
      : r.ok
        ? "Pre-Score is for wallets. This address is a contract on Elysium."
        : "Check your Elysium Pre-Score: an activity-based reading from 0 to 1000.";
  const title = `Pre-Score ${short}`;
  return {
    title,
    description,
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

  const result = await load(address);
  if (!result.ok) {
    if (result.reason === "invalid") notFound();
    return <ScoreUnavailable address={address} reason={result.reason} />;
  }
  if (result.kind === "contract") return <ContractNotice address={address} />;
  return <ScoreReveal result={result} />;
}
