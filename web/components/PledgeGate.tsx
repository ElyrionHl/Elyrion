import type { CSSProperties } from "react";
import { GateLogo } from "@/components/brand/GateLogo";
import { Reveal } from "@/components/brand/Reveal";
import { PLEDGE_AMOUNT, PLEDGE_LINE, PLEDGE_SOURCE, PLEDGE_UNIT, pledgeView } from "@/lib/pledge";

export type PledgeGateProps = {
  /** pool.depositedOf(treasury): net USDC principal the treasury deposited (6 decimals), from getPledge(). */
  deposited: bigint;
  /** False when the chain could not be read: the amount shows "—", never a number. Default true. */
  ok?: boolean;
  /** Explorer link for the treasury wallet (or the pool) that the deposited amount points to. */
  href?: string;
};

const TICKS = ["$0", "$250", "$500", "$750", "$1,000"];

/**
 * "Team Pledge $1,000 — The Gate Opens". The pledge is shown big; the on-chain
 * amount is read live and linked to the explorer. The Gate opens (GateLogo
 * `open`, "The Gate is open") only once the on-chain amount reaches $1,000.
 * Copy is fixed by the copy rules. Server Component.
 */
export function PledgeGate({ deposited, ok = true, href }: PledgeGateProps) {
  const { isOpen, pct, amount, pctText, statusText, dollars } = pledgeView(deposited, ok);

  return (
    <section id="pledge" aria-labelledby="pledge-title" className="relative">
      <div className="mx-auto max-w-[1240px] px-4 py-20 sm:px-8 md:py-28">
        <div
          className="pledge relative grid overflow-hidden rounded-[22px] border border-line bg-obsidian-2 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
          data-open={isOpen}
        >
          <Reveal className="gate-stage flex flex-col items-center justify-center gap-6 border-b border-line px-6 py-12 md:border-r md:border-b-0 md:py-16">
            <GateLogo
              size={112}
              animated
              open={isOpen}
              title={isOpen ? "The Gate is open" : "The Gate, closed until the pledge is on-chain"}
            />
            <span className="wordmark text-[22px]">ELYRION</span>
          </Reveal>

          <div className="min-w-0 px-5 py-10 sm:px-10 md:px-14 md:py-14">
            <Reveal>
              <p className="eyebrow">The team pledge · The Gate</p>
            </Reveal>
            <Reveal delay={0.1}>
              <h2 id="pledge-title" className="mt-5">
                <strong className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-normal">
                  <span className="num text-[56px] leading-none text-marble sm:text-[84px] lg:text-[104px]">
                    {PLEDGE_AMOUNT}
                  </span>{" "}
                  <span className="num text-[20px] leading-none text-gold sm:text-[28px]">{PLEDGE_UNIT}</span>
                </strong>
                <span className="display mt-4 block text-[26px] text-marble/90 sm:text-[34px]">
                  {PLEDGE_LINE}
                </span>
              </h2>
            </Reveal>

            <Reveal delay={0.2} className="mt-10 md:mt-12">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="num text-[13px] text-marble/85 sm:text-[14px]">
                  Deposited on-chain:{" "}
                  {ok && href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold underline decoration-gold/40 underline-offset-4 transition-colors duration-500 hover:text-marble hover:decoration-marble/60"
                    >
                      {amount}
                    </a>
                  ) : (
                    <span className={ok ? "text-gold" : "text-mute"}>{amount}</span>
                  )}{" "}
                  / {PLEDGE_AMOUNT}
                </p>
                <p className="stat-key">{pctText}</p>
              </div>

              <div
                role="progressbar"
                aria-label="Pledge deposited on-chain"
                aria-valuemin={0}
                aria-valuemax={1000}
                aria-valuenow={dollars}
                aria-valuetext={ok ? `${amount} of $1,000 deposited on-chain` : "Unavailable"}
                className="relative mt-4 h-[3px] rounded-full bg-line"
              >
                <div
                  className="reveal-grow absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-deep via-gold-2 to-gold"
                  style={{ "--w": `${pct}%` } as CSSProperties}
                >
                  <span
                    aria-hidden="true"
                    className="pledge-head absolute top-1/2 right-0 size-[9px] translate-x-1/2 -translate-y-1/2 rounded-full bg-gold"
                  />
                </div>
              </div>
              <div aria-hidden="true" className="mt-3 flex justify-between font-mono text-[10px] text-mute">
                {TICKS.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>

              <p className="mt-8 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.08em] text-mute">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${isOpen ? "bg-gold" : "border border-gold/60"}`}
                />
                {isOpen ? <span className="text-gold">{statusText}</span> : statusText}
              </p>
              <p className="mt-2 pl-4 text-[12.5px] leading-relaxed text-mute">
                {PLEDGE_SOURCE}
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PledgeGate;
