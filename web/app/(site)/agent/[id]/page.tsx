import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/brand/Reveal";
import { HouseBadge, StatusBadge } from "@/components/AgentTable";
import { CopyCheckApi } from "@/components/CopyCheckApi";
import { ScoreRing } from "@/components/ScoreRing";
import { parseAgentMeta } from "@/lib/agent-uri";
import { STATUS_LABEL } from "@/lib/board";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain";
import { formatUsdc, formatUsdcExact, shortAddr } from "@/lib/format";
import { getAgent, getAgentLoans, type AgentLoan } from "@/lib/indexer";

export const revalidate = 15;

const MAX_ID = 1e12;

/** Positive integer ≤ 1e12, else null. */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,12}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_ID ? n : null;
}

export async function generateMetadata({ params }: PageProps<"/agent/[id]">): Promise<Metadata> {
  const id = parseId((await params).id);
  if (id === null) return {};
  const { item } = await getAgent(id);
  const name = (item && parseAgentMeta(item.uri).name) || `Agent #${id}`;
  return { title: name, description: `On-chain credit record for ${name} on Elysium.` };
}

const utc = (sec: number) =>
  sec > 0 ? `${new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";

const LOAN_STATUS: Record<AgentLoan["status"], string> = {
  open: "Open",
  repaid: "Repaid",
  defaulted: "Defaulted",
};

function TxA({ hash, label }: { hash: string | null; label: string }) {
  if (!hash) return <span className="text-mute">—</span>;
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="num whitespace-nowrap text-gold underline decoration-gold/30 underline-offset-4 transition-colors duration-500 hover:text-marble"
    >
      {label} ↗
    </a>
  );
}

function Stat({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-obsidian-2 p-5">
      <dt className="stat-key">{k}</dt>
      <dd className="num mt-2 min-w-0 truncate text-[20px] text-marble">{children}</dd>
    </div>
  );
}

export default async function AgentPage({ params }: PageProps<"/agent/[id]">) {
  const id = parseId((await params).id);
  if (id === null) notFound();

  const [{ ok, item }, loans] = await Promise.all([getAgent(id), getAgentLoans(id)]);
  if (ok && !item) notFound();

  if (!ok || !item) {
    return (
      <section className="mx-auto max-w-[1240px] px-4 py-20 sm:px-8">
        <p className="eyebrow">Agent · #{id}</p>
        <h1 className="display mt-4 text-[48px]">Agent #{id}</h1>
        <div role="status" className="mt-8 flex items-start gap-3 rounded-[18px] border border-line bg-obsidian-2 p-6 text-[14px] text-marble/85">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
          <span>
            <strong className="font-medium text-gold">Chain data unavailable</strong> — this agent could not be read from
            Elysium right now. Try again shortly.
          </span>
        </div>
      </section>
    );
  }

  const meta = parseAgentMeta(item.uri);
  const name = meta.name ?? `Agent #${id}`;

  return (
    <>
      <section aria-labelledby="agent-title" className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 pt-12 pb-14 sm:px-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-16 md:pt-16 md:pb-20">
          <Reveal className="justify-self-center md:justify-self-start">
            <ScoreRing score={item.score} />
          </Reveal>

          <div className="min-w-0">
            <Reveal>
              <p className="eyebrow">
                <Link href="/board" className="transition-colors duration-500 hover:text-marble">
                  Credit Board
                </Link>{" "}
                · Agent #{id}
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 id="agent-title" className="display mt-4 text-[44px] break-words sm:text-[64px]">
                {name}
              </h1>
            </Reveal>
            <Reveal delay={0.14} className="mt-4 flex flex-wrap items-center gap-2.5">
              <StatusBadge status={item.status} />
              {item.isHouse ? <HouseBadge /> : null}
            </Reveal>
            {meta.description ? (
              <Reveal delay={0.18}>
                <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-marble/80">{meta.description}</p>
              </Reveal>
            ) : null}
            {meta.endpoint ? (
              <Reveal delay={0.22}>
                <a
                  href={meta.endpoint}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="num mt-4 inline-block max-w-full truncate text-[12.5px] text-gold underline decoration-gold/30 underline-offset-4 transition-colors duration-500 hover:text-marble"
                >
                  {meta.endpoint} ↗
                </a>
              </Reveal>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-label="Credit record" className="mx-auto max-w-[1240px] px-4 py-12 sm:px-8 md:py-16">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line bg-line md:grid-cols-3 lg:grid-cols-6">
            <Stat k="Score">{item.score}</Stat>
            <Stat k="Repaid">{item.repaidCount}</Stat>
            <Stat k="Qualified">{item.qualifiedRepaid}</Stat>
            <Stat k="Line">{item.lineAmount > 0n ? formatUsdc(item.lineAmount) : "—"}</Stat>
            <Stat k="Status">
              <span className="text-[15px]">{STATUS_LABEL[item.status]}</span>
            </Stat>
            <Stat k="Owner">
              <a
                href={explorerAddressUrl(item.owner)}
                target="_blank"
                rel="noopener noreferrer"
                title={item.owner}
                className="text-[15px] text-gold transition-colors duration-500 hover:text-marble"
              >
                {shortAddr(item.owner)} ↗
              </a>
            </Stat>
          </dl>
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-14">
          <div className="min-w-0">
            <Reveal>
              <h2 className="display text-[32px]">Loan history</h2>
            </Reveal>
            <Reveal delay={0.08} className="mt-5">
              {!loans.ok ? (
                <p className="text-[14px] text-mute">Chain data unavailable.</p>
              ) : loans.items.length === 0 ? (
                <p className="rounded-[16px] border border-line bg-obsidian-2 p-6 text-[14px] text-mute">
                  No loans yet. Every repaid loan appears here with its transactions.
                </p>
              ) : (
                <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line">
                  {loans.items.map((l) => (
                    <li key={l.loanId} className="grid gap-3 bg-obsidian-2 p-5 sm:grid-cols-[88px_minmax(0,1fr)_132px] sm:items-center sm:gap-6">
                      <div className="flex items-center justify-between gap-3 sm:block">
                        <span className="num text-[12px] text-mute">Loan #{l.loanId}</span>
                        <span
                          className={`font-mono text-[10px] uppercase tracking-[0.16em] sm:mt-1.5 sm:block ${l.status === "repaid" ? "text-gold" : l.status === "defaulted" ? "text-marble/50" : "text-marble/80"}`}
                        >
                          {LOAN_STATUS[l.status]}
                        </span>
                      </div>
                      <div className="num grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-3 text-[13px]">
                        <div className="min-w-0">
                          <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Principal</span>
                          {formatUsdc(l.principal)}
                        </div>
                        <div className="min-w-0">
                          <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Fee</span>
                          {formatUsdcExact(l.fee)}
                        </div>
                        <div className="min-w-0">
                          <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Due</span>
                          <span className="text-[12px]">{utc(l.dueAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] sm:justify-end">
                        <TxA hash={l.borrowTx} label="Borrow" />
                        {l.status !== "open" ? <TxA hash={l.closeTx} label={l.status === "repaid" ? "Repay" : "Default"} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Reveal>
          </div>

          <aside className="min-w-0">
            <Reveal>
              <h2 className="display text-[32px]">Check API</h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
                Any protocol can read this agent&apos;s score and line as JSON before it extends credit.
              </p>
            </Reveal>
            <Reveal delay={0.08} className="mt-5">
              <CopyCheckApi id={id} />
            </Reveal>
          </aside>
        </div>
      </section>
    </>
  );
}
