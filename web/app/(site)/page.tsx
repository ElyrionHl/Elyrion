import Link from "next/link";
import type { ReactNode } from "react";
import { GateLogo } from "@/components/brand/GateLogo";
import { Reveal } from "@/components/brand/Reveal";
import { RiskNote } from "@/components/brand/RiskNote";
import { Hero } from "@/components/hero/Hero";
import { PledgeGate } from "@/components/PledgeGate";
import { explorerAddressUrl } from "@/lib/chain";
import { readConfig } from "@/lib/contracts";
import { getStats } from "@/lib/indexer";

/** Re-render at most every 15 s (the indexer caches chain reads for the same TTL). */
export const revalidate = 15;

const STEPS: { title: string; body: string }[] = [
  {
    title: "Register",
    body: "Mint an ERC-8004-compatible identity for the agent on Elysium.",
  },
  {
    title: "Request a line",
    body: "The owner asks for a USDC credit line of up to $50. A backer opens it by locking pool shares behind it.",
  },
  {
    title: "Borrow",
    body: "Against an open line, the agent borrows $5 to $50 for 1 to 7 days. One open loan at a time.",
  },
  {
    title: "Repay",
    body: "Principal plus a fee of 1% per 30 days, prorated by term. Anyone can repay on the agent's behalf.",
  },
  {
    title: "Score",
    body: "A public 0–1000 score from dollar-days repaid, qualified loans, backing and age. A default sets it to 0 for good.",
  },
];

type Audience = {
  key: string;
  title: string;
  body: string;
  facts: [string, string][];
  cta: { href: string; label: string };
  risk?: boolean;
};

const AUDIENCES: Audience[] = [
  {
    key: "For Agents",
    title: "Earn your credit.",
    body: "Register an identity, get a small USDC line, then borrow and repay. Every repayment builds a score any protocol can check through the API.",
    facts: [
      ["Loan size", "$5 – $50"],
      ["Term", "1 – 7 days"],
      ["Fee", "1% / 30 days"],
    ],
    cta: { href: "/register", label: "Register an agent" },
  },
  {
    key: "For Lenders",
    title: "Fund the pool.",
    body: "Deposit USDC into the credit pool. Every line is backed by a backer's locked pool shares, which are burned to cover the principal if an agent defaults. Lenders receive half of each loan fee.",
    facts: [
      ["Fee share", "50%"],
      ["Per wallet", "$1,000 cap"],
      ["Pool", "$10,000 cap"],
    ],
    cta: { href: "/lend", label: "Lend" },
    risk: true,
  },
  {
    key: "For Backers",
    title: "Vouch with your shares.",
    body: "Lock your pool shares behind one agent's credit line and receive a quarter of its loan fees. If it defaults, your locked shares cover the loss. A line stays with the agent's identity, even if its NFT changes hands.",
    facts: [
      ["Fee share", "25%"],
      ["Line", "up to $50"],
      ["On default", "shares burned"],
    ],
    cta: { href: "/docs", label: "Read the docs" },
  },
];

const ELYR_FLOW = ["Creator fees", "Swapped to USDC", "Treasury backing", "Agent credit lines"];

function SectionHead({
  id,
  eyebrow,
  title,
  aside,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between md:gap-10">
      <div>
        <Reveal>
          <p className="eyebrow">{eyebrow}</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 id={id} className="display mt-3 text-[38px] sm:text-[52px]">
            {title}
          </h2>
        </Reveal>
      </div>
      {aside ? (
        <Reveal delay={0.16}>
          <p className="max-w-[420px] text-[13.5px] leading-relaxed text-mute md:text-right">{aside}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

export default async function Home() {
  const stats = await getStats();
  const { pool, treasury } = readConfig();
  const pledgeAddress = treasury ?? pool;

  return (
    <>
      <Hero
        initial={{
          ok: stats.ok,
          agents: stats.agents,
          loansRepaid: stats.loansRepaid,
          defaults: stats.defaults,
          recentEvents: stats.recentEvents.map((e) => ({
            kind: e.kind,
            agentId: e.agentId,
            block: e.block.toString(),
          })),
        }}
      />

      <PledgeGate
        deposited={stats.treasuryDeposited}
        ok={stats.ok}
        href={pledgeAddress ? explorerAddressUrl(pledgeAddress) : undefined}
      />

      {/* How it works */}
      <section aria-labelledby="how-title" className="mx-auto max-w-[1240px] px-4 py-20 sm:px-8 md:py-28">
        <SectionHead
          id="how-title"
          eyebrow="How it works"
          title={
            <>
              Credit you <em>earn</em>, one loan at a time.
            </>
          }
          aside="Scores come from on-chain activity only: loans repaid, the line behind them, and time since the first repayment."
        />
        <ol className="steps mt-10 grid gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-obsidian">
              <Reveal delay={i * 0.08} className="flex h-full flex-col gap-4 p-6 lg:min-h-[260px] lg:p-7">
                <div className="flex items-center gap-3">
                  <span className="num text-[12px] text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                  {i < STEPS.length - 1 ? (
                    <span aria-hidden="true" className="font-mono text-[12px] text-gold/60">
                      →
                    </span>
                  ) : (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                  )}
                </div>
                <h3 className="display text-[28px]">{s.title}</h3>
                <p className="text-[13.5px] leading-relaxed text-mute">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* Agents / Lenders / Backers */}
      <section aria-labelledby="who-title" className="mx-auto max-w-[1240px] px-4 py-20 sm:px-8 md:py-28">
        <SectionHead
          id="who-title"
          eyebrow="Who it is for"
          title={
            <>
              Three ways <em>through</em> the Gate.
            </>
          }
          aside="Agents build credit. Lenders fund the pool. Backers put their own shares behind the agents they trust."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.key} delay={i * 0.1} className="h-full">
              <article className="audience flex h-full flex-col rounded-[18px] border border-line bg-obsidian-2 p-6 sm:p-8">
                <p className="stat-key">{a.key}</p>
                <h3 className="display mt-4 text-[32px]">{a.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-mute">{a.body}</p>
                <dl className="mt-7 grid grid-cols-3 gap-3 border-t border-line pt-5">
                  {a.facts.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-mute">{k}</dt>
                      <dd className="num mt-1.5 text-[13px] text-marble">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-8">
                  <Link href={a.cta.href} className="btn text-marble">
                    {a.cta.label}
                  </Link>
                  {a.risk ? <RiskNote /> : null}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* $ELYR */}
      <section aria-labelledby="elyr-title" className="border-y border-line bg-obsidian-2">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 sm:px-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-28">
          <div>
            <Reveal>
              <p className="eyebrow">The token</p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 id="elyr-title" className="display mt-3 text-[64px] sm:text-[96px]">
                $ELYR
              </h2>
            </Reveal>
          </div>
          <div className="md:pt-8">
            <Reveal delay={0.12}>
              <p className="display text-[24px] leading-[1.3] text-marble/90 sm:text-[30px]">
                Creator fees from $ELYR trading are swapped to USDC by the team and deposited as
                treasury backing for agent credit lines. No yield is promised to holders.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <ol className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-3">
                {ELYR_FLOW.map((step, i) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className="rounded-full border border-line px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-marble/85">
                      {step}
                    </span>
                    {i < ELYR_FLOW.length - 1 ? (
                      <span aria-hidden="true" className="font-mono text-[12px] text-gold/70">
                        →
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section aria-labelledby="close-title" className="mx-auto max-w-[1240px] px-4 py-24 text-center sm:px-8 md:py-32">
        <Reveal className="flex flex-col items-center">
          <GateLogo size={64} animated />
          <h2 id="close-title" className="display mt-8 text-[44px] sm:text-[64px]">
            Only the <em>worthy</em> enter.
          </h2>
          <p className="mx-auto mt-5 max-w-[420px] text-[15px] leading-relaxed text-mute">
            Registration is open. Give your agent an identity and start its record.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Link href="/register" className="btn btn-solid">
              Register an agent
            </Link>
            <Link href="/board" className="btn text-marble">
              View the board
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
