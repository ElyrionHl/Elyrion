"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { shortAddr } from "@/lib/format";
import type { PreScoreResult } from "@/lib/prescore/service";
import { ContractNotice } from "./ContractNotice";
import { ScoreReveal, type WalletResult } from "./ScoreReveal";

/**
 * Honest failure state (explorer down / rate-limited). Retry asks the API again and, when it answers, shows
 * the reading in place; it also refreshes the route (`router.refresh()`) so the server render catches up.
 */
export function ScoreUnavailable({ address, reason }: { address: string; reason: "explorer" | "rate-limited" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const [fresh, setFresh] = useState<WalletResult | { kind: "contract"; address: string } | null>(null);

  // After a successful Retry the page content is replaced: move focus to the new heading.
  useEffect(() => {
    if (!fresh) return;
    const raf = requestAnimationFrame(() =>
      document.getElementById(fresh.kind === "wallet" ? "prescore-result" : "prescore-contract")?.focus(),
    );
    return () => cancelAnimationFrame(raf);
  }, [fresh]);

  if (fresh?.kind === "wallet") return <ScoreReveal result={fresh} />;
  if (fresh?.kind === "contract") return <ContractNotice address={fresh.address} />;

  const retry = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/prescore?address=${address}`, { cache: "no-store" });
      const body = (await res.json()) as PreScoreResult;
      if (body.ok && body.kind === "wallet") setFresh(body);
      else if (body.ok && body.kind === "contract") setFresh(body);
    } catch {
      // stays unavailable
    } finally {
      setBusy(false);
      setTries((n) => n + 1);
      startTransition(() => router.refresh());
    }
  };

  const working = busy || pending;

  return (
    <section aria-labelledby="prescore-unavailable" className="relative overflow-hidden border-b border-line">
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1240px] px-4 pt-14 pb-20 sm:px-8 md:pt-20 md:pb-28">
        <p className="eyebrow">
          <Link href="/score" className="transition-colors duration-500 hover:text-marble">
            Pre-Score
          </Link>{" "}
          · <span className="num tracking-[0.08em] normal-case">{shortAddr(address)}</span>
        </p>
        <h1 id="prescore-unavailable" className="display mt-4 text-[44px] sm:text-[64px]">
          The explorer is <em>silent</em>.
        </h1>
        <div role="status" className="mt-8 flex max-w-[620px] items-start gap-3 rounded-[18px] border border-line bg-obsidian-2 p-5 text-[14px] leading-relaxed text-marble/85 sm:p-6">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
          <span>
            {reason === "rate-limited" ? (
              <>
                <strong className="font-medium text-gold">Too many readings at once.</strong> Wait a minute, then try
                again.
              </>
            ) : (
              <>
                <strong className="font-medium text-gold">Activity data is unavailable right now.</strong> The Elysium
                explorer did not answer, so no score was computed. Nothing is guessed.
              </>
            )}
            {tries > 0 && !working ? <span className="mt-2 block text-mute">Still no answer. Try again shortly.</span> : null}
          </span>
        </div>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <button type="button" className="btn btn-solid disabled:cursor-wait disabled:opacity-70" onClick={() => void retry()} disabled={working}>
            {working ? "Trying…" : "Retry"}
          </button>
          <Link href="/score" className="btn text-marble">
            Another address
          </Link>
        </div>
      </div>
    </section>
  );
}

export default ScoreUnavailable;
