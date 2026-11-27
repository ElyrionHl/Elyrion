"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { CountUp } from "@/components/brand/CountUp";
import { ScoreRing } from "@/components/ScoreRing";
import { explorerAddressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { DISCLAIMER, TIER_BOUNDS } from "@/lib/prescore/constants";
import type { PreScoreResult } from "@/lib/prescore/service";
import { breakdownRows, isFresh, readingLines } from "@/lib/prescore/view";
import { ReadingPanel } from "./ReadingPanel";
import { ShareCard } from "./ShareCard";

export type WalletResult = Extract<PreScoreResult, { kind: "wallet" }>;

/** Each reading line holds this long before the next one (spec: ~350 ms). */
const LINE_MS = 350;
/** Last line lingers a beat before the reveal. */
const SETTLE_MS = 420;

type Phase = "pending" | "reading" | "done";

/**
 * Reveal gate for this page: like <Reveal>, but it waits for both the reading sequence to finish (`ready`)
 * and the element to enter the viewport. Same CSS (`[data-reveal]`), so reduced motion and no-JS behave.
 */
function Rv({
  ready,
  delay = 0,
  as,
  className,
  style,
  children,
}: {
  ready: boolean;
  delay?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const Tag: ElementType = as ?? "div";
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref}
      data-reveal={ready && seen ? "in" : "pending"}
      className={className}
      style={delay ? { ...style, transitionDelay: `${delay}s` } : style}
    >
      {children}
    </Tag>
  );
}

const tierRange = (tier: string) => {
  const i = TIER_BOUNDS.findIndex((b) => b.tier === tier);
  if (i < 0) return "";
  const hi = i === 0 ? 1000 : TIER_BOUNDS[i - 1].min - 1;
  return `${TIER_BOUNDS[i].min}–${hi}`;
};

/**
 * The Pre-Score result. Choreography (single easing, see globals.css):
 *  1. Reading — three mono lines with the real numbers step in, ~350 ms each (fresh results only).
 *  2. Reveal — the ring fills and counts, the tier word sharpens in, traits / profile / badge follow at
 *     ~80 ms steps; the breakdown bars grow in a 120 ms stagger as they enter the viewport.
 * Cached results (computedAt > 10 s old) and reduced motion skip step 1; reduced motion lands everything static.
 */
export function ScoreReveal({ result }: { result: WalletResult }) {
  const { score, metrics, traits, profile, agents, address, partial } = result;
  const lines = readingLines(metrics);
  const [phase, setPhase] = useState<Phase>("pending");
  const [step, setStep] = useState(-1);
  const done = phase === "done";

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    if (prefersReducedMotion() || !isFresh(result.computedAt, Date.now())) {
      at(0, () => setPhase("done"));
    } else {
      at(0, () => {
        setPhase("reading");
        setStep(0);
      });
      at(LINE_MS, () => setStep(1));
      at(LINE_MS * 2, () => setStep(2));
      at(LINE_MS * 3 + SETTLE_MS, () => setPhase("done"));
    }
    return () => timers.forEach(clearTimeout);
  }, [result.computedAt]);

  const agent = agents.length ? [...agents].sort((a, b) => b.score - a.score)[0] : null;
  const rows = breakdownRows(score, metrics);
  const short = shortAddr(address);

  return (
    <>
      <section aria-labelledby="prescore-result" className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="prescore-halo pointer-events-none absolute inset-0" data-on={done} />

        {/* 1 · Reading sequence (client only; hidden without JS via the <noscript> rule below). */}
        <div
          aria-hidden="true"
          data-phase={phase}
          className="prescore-reading pointer-events-none absolute inset-x-0 top-0 z-10 grid h-[420px] place-items-center px-4 sm:px-8 md:h-[468px]"
        >
          <ReadingPanel label={`Reading Elysium · ${short}`} lines={lines} step={step} />
        </div>
        <noscript>
          <style>{`.prescore-reading{display:none!important}`}</style>
        </noscript>
        <p className="sr-only" role="status">
          {done ? `Pre-Score ${score.total} of 1000, tier ${score.tier}.` : `Reading ${short}.`}
        </p>

        {/* 2 · The reveal */}
        <div className="relative mx-auto grid max-w-[1240px] gap-10 px-4 pt-12 pb-14 sm:px-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-16 md:pt-16 md:pb-20">
          <Rv ready={done} className="justify-self-center md:justify-self-start">
            {/* Remounting at the reveal restarts the fill + count from 0 in step with the entrance. */}
            <ScoreRing key={done ? "reveal" : "wait"} score={score.total} size={248} delay={0.25} label="Pre-Score / 1000" />
          </Rv>

          <div className="min-w-0">
            <Rv ready={done} delay={0.08}>
              <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href="/score" className="transition-colors duration-500 hover:text-marble">
                  Pre-Score
                </Link>
                <span aria-hidden="true">·</span>
                <a
                  href={explorerAddressUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={address}
                  className="num tracking-[0.08em] normal-case transition-colors duration-500 hover:text-marble"
                >
                  {short} ↗
                </a>
              </p>
            </Rv>
            <Rv ready={done} delay={0.16}>
              <h1 id="prescore-result" className="display mt-4 text-[64px] sm:text-[88px] lg:text-[104px]">
                <span className="sr-only">Pre-Score {score.total}: </span>
                <em>{score.tier}</em>
              </h1>
            </Rv>
            <Rv ready={done} delay={0.24}>
              <p className="mt-3 font-mono text-[11px] leading-[1.7] uppercase tracking-[0.18em] text-mute">
                Tier <span className="num text-marble/80">{tierRange(score.tier)}</span>
                <span aria-hidden="true" className="mx-2.5 hidden text-gold/50 sm:inline">/</span>
                <span className="block sm:inline">{DISCLAIMER}</span>
              </p>
            </Rv>

            {traits.length ? (
              <Rv ready={done} delay={0.32} as="ul" className="mt-6 flex flex-wrap gap-2" >
                {traits.slice(0, 3).map((t) => (
                  <li
                    key={t.id}
                    className="rounded-full border border-gold/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-marble/85"
                  >
                    {t.label}
                  </li>
                ))}
              </Rv>
            ) : null}

            <Rv ready={done} delay={0.4}>
              <p className="mt-6 max-w-[560px] text-[15.5px] leading-relaxed text-marble/85 sm:text-[16.5px]">{profile}</p>
            </Rv>

            {partial ? (
              <Rv ready={done} delay={0.44}>
                <p role="status" className="mt-4 flex max-w-[560px] items-start gap-3 text-[13px] leading-relaxed text-mute">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
                  <span>
                    <strong className="font-medium text-marble/85">Partial reading.</strong> Token transfers could not be
                    read just now, so Breadth may be lower than it should be. Check again in a few minutes.
                  </span>
                </p>
              </Rv>
            ) : null}

            <Rv ready={done} delay={0.48} className="mt-8">
              {agent ? (
                <div className="flex max-w-[560px] flex-wrap items-center gap-x-5 gap-y-4 rounded-[18px] border border-gold/40 bg-obsidian/60 p-4 pr-5 shadow-[0_30px_80px_-50px_rgba(226,197,139,0.45)] sm:p-5">
                  <span className="inline-flex items-center gap-2 rounded-full bg-gold px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink">
                    <span aria-hidden="true" className="size-1 rounded-full bg-ink" />
                    Registered Agent
                  </span>
                  <span className="text-[13.5px] text-marble/80">
                    Agent #{agent.id} · credit score <span className="num text-marble">{agent.score}</span>
                    {agents.length > 1 ? <span className="text-mute"> · {agents.length} agents</span> : null}
                  </span>
                  <Link href={`/agent/${agent.id}`} className="btn btn-solid sm:ml-auto">
                    View credit profile
                  </Link>
                </div>
              ) : (
                <Link
                  href="/register"
                  className="group inline-flex items-center gap-3 rounded-full border border-line py-2 pr-2 pl-5 text-[13.5px] text-marble/85 transition-[border-color,color] duration-500 hover:border-gold/60 hover:text-marble"
                >
                  Earn a real credit score
                  <span className="btn btn-solid px-4 py-2 text-[12px]">
                    Register an agent
                    <span aria-hidden="true" className="transition-transform duration-700 group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                </Link>
              )}
            </Rv>
          </div>
        </div>
      </section>

      {/* Breakdown */}
      <section aria-labelledby="prescore-breakdown" className="mx-auto max-w-[1240px] px-4 pt-14 sm:px-8 md:pt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Rv ready={done}>
            <h2 id="prescore-breakdown" className="display text-[32px] sm:text-[40px]">
              The <em>reading</em>
            </h2>
          </Rv>
          <Rv ready={done} delay={0.06}>
            <Link
              href="/docs#prescore"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-marble/70 transition-colors duration-500 hover:text-gold"
            >
              How it is scored →
            </Link>
          </Rv>
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((r, i) => (
            <li key={r.key} className="bg-obsidian-2">
              <Rv ready={done} delay={0.12 * i} className="p-5 sm:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="stat-key">{r.label}</span>
                  <span className="num text-[13px] text-mute">
                    <CountUp key={done ? "on" : "off"} value={r.points} delay={0.35 + 0.12 * i} duration={1.8} className="text-[22px] text-marble" />
                    <span className="ml-1">/ {r.max}</span>
                  </span>
                </div>
                <div className="mt-4 h-[2px] w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <div
                    className="reveal-grow h-full rounded-full bg-gradient-to-r from-gold-deep via-gold-2 to-gold"
                    style={{ "--w": `${(r.points / r.max) * 100}%`, transitionDelay: `${0.35 + 0.12 * i}s` } as CSSProperties}
                  />
                </div>
                <p className="mt-3.5 text-[13px] leading-relaxed text-marble/65">{r.detail}</p>
              </Rv>
            </li>
          ))}
        </ul>
      </section>

      {/* Share */}
      <section aria-labelledby="prescore-share" className="mx-auto max-w-[1240px] px-4 pt-20 pb-20 sm:px-8 md:pt-28 md:pb-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center lg:gap-16">
          <Rv ready={done}>
            <p className="eyebrow">Share</p>
            <h2 id="prescore-share" className="display mt-4 text-[38px] sm:text-[48px]">
              Carry the <em>mark</em>.
            </h2>
            <p className="mt-4 max-w-[380px] text-[14.5px] leading-relaxed text-mute">
              The card is drawn from the same reading. Post it, save it, or send the link: the page reads the chain
              again for whoever opens it.
            </p>
          </Rv>
          <Rv ready={done} delay={0.1}>
            <ShareCard address={address} total={score.total} tier={score.tier} traits={traits.slice(0, 3).map((t) => t.label)} />
          </Rv>
        </div>
      </section>
    </>
  );
}

export default ScoreReveal;
