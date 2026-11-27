import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Reveal } from "@/components/brand/Reveal";
import { Constellation } from "@/components/hero/Constellation";
import { ScoreSearch } from "@/components/prescore/ScoreSearch";
import { PRESCORE_PARTS } from "@/lib/docs-copy";
import { DISCLAIMER } from "@/lib/prescore/constants";
import { parseAddressInput } from "@/lib/prescore/view";

export const metadata: Metadata = {
  title: "Pre-Score",
  description: "How worthy is your wallet? An activity-based Pre-Score from 0 to 1000 for any Elysium address.",
};

const NO_PULSES: never[] = [];

/** /score — search. `?address=` (the no-JS form submit) redirects to the result page. */
export default async function ScorePage({ searchParams }: PageProps<"/score">) {
  const q = (await searchParams).address;
  const addr = parseAddressInput(Array.isArray(q) ? (q[0] ?? "") : (q ?? ""));
  if (addr) redirect(`/score/${addr}`);

  return (
    <>
      <section data-hero aria-labelledby="prescore-title" className="hero relative isolate overflow-hidden">
        <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0 -z-10" />
        <Constellation pulses={NO_PULSES} className="-z-10" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-obsidian"
        />

        <div className="mx-auto flex min-h-[max(620px,84svh)] max-w-[1240px] items-center px-4 pt-[164px] pb-16 sm:px-8 sm:pt-[132px] lg:pb-20">
          <div className="w-full max-w-[640px]">
            <Reveal>
              <p className="eyebrow">Pre-Score · Elysium</p>
            </Reveal>
            <h1 id="prescore-title" className="display mt-4 text-[46px] sm:text-[66px] lg:text-[80px]">
              <Reveal as="span" delay={0.1}>
                How&nbsp;<em>worthy</em>
              </Reveal>
              <br />
              <Reveal as="span" delay={0.22}>
                is your wallet?
              </Reveal>
            </h1>
            <Reveal delay={0.34}>
              <p className="mt-6 max-w-[470px] text-[15px] leading-relaxed text-mute sm:text-[16px]">
                A reading of any Elysium address from its public activity: how long it has been here, how often it
                moves, how widely it reaches. Scored from 0 to 1000.
              </p>
            </Reveal>
            <Reveal delay={0.44} className="mt-10">
              <ScoreSearch />
            </Reveal>
            <Reveal delay={0.54}>
              <p className="mt-10 flex items-start gap-3 font-mono text-[10.5px] leading-[1.6] uppercase tracking-[0.18em] text-mute">
                <span aria-hidden="true" className="mt-[0.8em] h-px w-6 shrink-0 bg-gold/50" />
                {DISCLAIMER}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <section aria-labelledby="prescore-parts" className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-8 md:pb-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Reveal>
            <h2 id="prescore-parts" className="stat-key">
              What is read
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <Link
              href="/docs#prescore"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-marble/70 transition-colors duration-500 hover:text-gold"
            >
              How it is scored →
            </Link>
          </Reveal>
        </div>
        <ul className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {PRESCORE_PARTS.map((p, i) => (
            <li key={p.part} className="bg-obsidian-2">
              <Reveal delay={0.06 * i} className="flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="display text-[26px]">{p.part}</span>
                  <span className="num text-[12px] text-gold">{p.max}</span>
                </div>
                <p className="mt-3 text-[13.5px] leading-relaxed text-marble/70">{p.plain}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
