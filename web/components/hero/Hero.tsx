"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CountUp } from "@/components/brand/CountUp";
import { Reveal } from "@/components/brand/Reveal";
import {
  eventKey,
  FIRST_LOAD_PULSES,
  liveLabel,
  parseLiveEvents,
  takeNewEvents,
  type LiveEvent,
} from "@/lib/live-events";
import { Constellation } from "./Constellation";

export type HeroStats = {
  ok: boolean;
  /** The server served an older snapshot because its last refresh failed. */
  stale: boolean;
  /** Unix ms of the snapshot; null when none. */
  updatedAt: number | null;
  agents: number;
  loansRepaid: number;
  defaults: number;
  /** Newest first, as getStats returns them. */
  recentEvents: LiveEvent[];
};

const POLL_MS = 15_000;

/** Latest few events, oldest first: the pulses to play on first load. Pure. */
function firstPulses(events: LiveEvent[]) {
  return events.slice(0, FIRST_LOAD_PULSES).reverse();
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Landing hero: "Obsidian Constellation". Server-rendered with the real stats
 * (numbers are in the HTML), then polls /api/stats every 15 s while the tab is
 * visible so the numbers stay live and new Borrowed/Repaid events pulse in the
 * constellation. A failed poll keeps the last real values; "—" is shown only
 * while no chain read has ever succeeded. After two failed polls in a row, or
 * when the server serves a stale snapshot, "Live · Elysium" becomes
 * "Last updated <time>".
 */
export function Hero({ initial }: { initial: HeroStats }) {
  const [stats, setStats] = useState(initial);
  const [seen] = useState(() => new Set(initial.recentEvents.map(eventKey)));
  const [pulses, setPulses] = useState(() => firstPulses(initial.recentEvents));
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let good = false;
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        const body = (await res.json()) as Record<string, unknown>;
        if (!alive || body.ok !== true) return;
        const agents = toInt(body.agents);
        const loansRepaid = toInt(body.loansRepaid);
        const defaults = toInt(body.defaults);
        if (agents === null || loansRepaid === null || defaults === null) return;
        const events = parseLiveEvents(body.recentEvents);
        const fresh = takeNewEvents(events, seen, false);
        const updatedAt = toInt(body.updatedAt);
        setStats({ ok: true, stale: body.stale === true, updatedAt, agents, loansRepaid, defaults, recentEvents: events });
        if (fresh.length) setPulses((prev) => [...prev, ...fresh].slice(-20));
        good = true;
      } catch {
        // Network/JSON error: keep showing the last real values.
      } finally {
        if (alive) setFailures((n) => (good ? 0 : n + 1));
        if (alive) schedule();
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") timer = setTimeout(poll, POLL_MS);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
      else clearTimeout(timer);
    };

    schedule();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [seen]);

  const latest = stats.recentEvents[0];
  const label = liveLabel({ ok: stats.ok, stale: stats.stale, failures, updatedAt: stats.updatedAt });
  const items: [string, number][] = [
    ["Agents registered", stats.agents],
    ["Loans repaid", stats.loansRepaid],
    ["Defaults", stats.defaults],
  ];

  return (
    <section
      data-hero
      aria-labelledby="hero-title"
      className="hero relative isolate overflow-hidden"
    >
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0 -z-10" />
      <Constellation pulses={pulses} className="-z-10" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-obsidian"
      />

      <div className="mx-auto grid min-h-[max(600px,86svh)] max-w-[1240px] grid-rows-[1fr_auto] gap-12 px-4 pt-[164px] pb-12 sm:px-8 sm:pt-[128px] lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-1 lg:gap-16 lg:pb-16">
        <div className="max-w-[600px] self-center">
          <Reveal>
            <p className="eyebrow">Credit layer for AI agents · Elysium</p>
          </Reveal>
          <h1 id="hero-title" className="display mt-4 text-[46px] sm:text-[66px] lg:text-[84px]">
            <Reveal as="span" delay={0.1}>
              Only&nbsp;the
            </Reveal>{" "}
            <Reveal as="span" delay={0.22}>
              <em>worthy</em>
            </Reveal>
            <br />
            <Reveal as="span" delay={0.34}>
              enter&nbsp;Elysium.
            </Reveal>
          </h1>
          <Reveal delay={0.46}>
            <p className="mt-6 max-w-[430px] text-[15px] leading-relaxed text-mute sm:text-[16px]">
              AI agents borrow, repay and build an onchain credit score anyone can verify.
            </p>
          </Reveal>
          <Reveal delay={0.56}>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link href="/register" className="btn btn-solid">
                Register an agent
              </Link>
              <Link href="/docs" className="btn text-marble">
                Read the docs
              </Link>
            </div>
          </Reveal>
          <Reveal delay={0.64}>
            <Link
              href="/score"
              className="group mt-7 inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-marble/75 transition-colors duration-500 hover:text-gold"
            >
              <span aria-hidden="true" className="h-px w-6 bg-gold/60 transition-[width] duration-700 group-hover:w-9" />
              Check your Pre-Score
              <span aria-hidden="true" className="transition-transform duration-700 group-hover:translate-x-1">
                →
              </span>
            </Link>
          </Reveal>
        </div>

        <Reveal delay={0.5} className="self-end">
          <div className="lg:text-right">
            <p className="stat-key flex items-center gap-2.5 lg:justify-end">
              <span
                aria-hidden="true"
                className={label.live ? "live-dot" : "size-1.5 rounded-full bg-mute"}
              />
              {label.text}
            </p>
            <dl className="mt-5 grid border-t border-line sm:grid-cols-3 sm:gap-6 sm:border-0 lg:mt-6 lg:grid-cols-1 lg:gap-[18px]">
              {items.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-4 border-b border-line py-3 sm:block sm:border-0 sm:py-0"
                >
                  <dt className="stat-key">{label}</dt>
                  <dd className="num text-[22px] sm:mt-1.5 sm:text-[28px]">
                    {stats.ok ? (
                      <CountUp value={value} />
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">unavailable</span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {stats.ok && latest ? (
              <p className="mt-5 font-mono text-[11px] tracking-[0.08em] text-mute lg:mt-6">
                Latest:{" "}
                <Link
                  href={`/agent/${latest.agentId}`}
                  className="text-marble/80 transition-colors duration-500 hover:text-gold"
                >
                  {latest.kind} · Agent #{latest.agentId}
                </Link>{" "}
                · block {latest.block}
              </p>
            ) : null}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default Hero;
