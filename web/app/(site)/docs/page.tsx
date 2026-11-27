import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/brand/Reveal";
import { RiskNote } from "@/components/brand/RiskNote";
import { PageHead } from "@/components/PageHead";
import { ELYSIUM_EXPLORER, ELYSIUM_RPC, explorerAddressUrl } from "@/lib/chain";
import { readConfig } from "@/lib/contracts";
import { DISCLAIMER } from "@/lib/prescore/constants";
import {
  BACKER_NOTE,
  DEFAULT_RULE,
  MCP_PACKAGE,
  MCP_SERVER_PATH,
  MCP_TOOLS,
  mcpConfig as buildMcpConfig,
  mcpInstallSteps,
  PRESCORE_COUNTING_RULE,
  PRESCORE_INTRO,
  PRESCORE_PARTS,
  PRESCORE_TIERS,
  PRIORS_CREDIT,
  SCORE_ROWS,
  SELF_BACKED_NOTE,
} from "@/lib/docs-copy";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Elyrion works: MCP setup, contracts, the credit score, the Pre-Score, caps and the check API.",
};

const TOOLS: [(typeof MCP_TOOLS)[number], string, string][] = [
  ["register_agent", "{ name, description, endpoint }", "Registers the agent and mints its ERC-8004-compatible identity to the agent wallet."],
  ["request_line", "{ agentId, amountUsd }", "Asks for a USDC credit line for the agent, up to $50."],
  ["check_score", "{ agentId }", "Reads the agent's 0–1000 score and repayment record."],
  ["get_line", "{ agentId }", "Reads the agent's credit line."],
  ["get_loans", "{ agentId }", "Lists the agent's loans."],
  ["borrow", "{ agentId, amountUsd, termDays }", "Borrows $5–$50 for 1–7 days against an open line. Checks the limits before sending."],
  ["repay", "{ loanId }", "Repays principal plus fee. Anyone can repay a loan on the agent's behalf."],
];

const CAPS: [string, string][] = [
  ["Loan size", "$5 – $50"],
  ["Term", "1 – 7 days"],
  ["Fee", "1% per 30 days, prorated by term"],
  ["Grace period", "1 day after the due date"],
  ["Deposits per wallet", "$1,000"],
  ["Total deposits", "$10,000"],
  ["Total outstanding loans", "$5,000"],
];

const SECTIONS: [string, string][] = [
  ["mcp", "MCP setup"],
  ["contracts", "Contracts"],
  ["score", "Score"],
  ["prescore", "Pre-Score"],
  ["caps", "Caps & fees"],
  ["backers", "Backers"],
  ["api", "Check API"],
  ["risk", "Risk"],
];

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Reveal>
      <h2 id={id} className="display scroll-mt-24 text-[34px] sm:text-[44px]">
        {children}
      </h2>
    </Reveal>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-[14px] border border-line bg-obsidian">
      {label ? (
        <figcaption className="border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
          {label}
        </figcaption>
      ) : null}
      <pre className="num overflow-x-auto p-4 text-[12px] leading-relaxed text-marble/85">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

const P = "text-[14.5px] leading-relaxed text-marble/75";

export default function DocsPage() {
  const { identity, pool, treasury, deployBlock } = readConfig();
  const sourceUrl = /^https:\/\//.test(process.env.NEXT_PUBLIC_SOURCE_URL ?? "") ? process.env.NEXT_PUBLIC_SOURCE_URL : undefined;
  const ADDRESSES: [string, string | undefined, string][] = [
    ["Identity registry", identity, "ElyrionIdentity · ERC-8004-compatible agent NFTs"],
    ["Credit pool", pool, "ElyrionPool · deposits, lines, loans, scores"],
    ["Treasury wallet", treasury, "Holds the team pledge as pool shares"],
  ];

  const mcpConfig = JSON.stringify(buildMcpConfig({ identity, pool, deployBlock }), null, 2);

  const checkExample = `{
  "ok": true,
  "agents": [
    {
      "id": 1,
      "score": 525,
      "repaidCount": 1,
      "qualifiedRepaid": 1,
      "defaulted": false,
      "lineAmount": "5000000",
      "backer": "0x…",
      "selfBacked": false
    }
  ],
  "stale": false,
  "updatedAt": 1795737789000
}`;

  return (
    <>
      <PageHead
        eyebrow="Docs · Elyrion"
        title={
          <>
            How the Gate <em>works</em>.
          </>
        }
        aside="Elyrion is the credit and reputation layer for AI agents on Elysium. Agents get an ERC-8004-compatible identity, borrow small USDC loans, and build a public score by repaying them."
      />

      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-14 sm:px-8 md:py-20 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
          <p className="stat-key">On this page</p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5 lg:flex-col">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="font-mono text-[11px] uppercase tracking-[0.16em] text-marble/70 transition-colors duration-500 hover:text-gold">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 grid-cols-1 gap-20">
          {/* MCP */}
          <section aria-labelledby="mcp" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="mcp">MCP setup</H2>
            <Reveal>
              <p className={P}>
                The Elyrion MCP server lets an agent register itself, request a line, borrow and repay from any
                MCP-capable client. It is installed from the source repository (Node.js 20+ and pnpm), not from npm:
              </p>
            </Reveal>
            <Reveal>
              <Code label="install from the repository">{mcpInstallSteps(sourceUrl)}</Code>
            </Reveal>
            <Reveal>
              <p className={P}>
                Then add it to your client&apos;s MCP config, replacing <span className="num text-marble">&lt;repo&gt;</span>{" "}
                with the full path of the clone:
              </p>
            </Reveal>
            <Reveal>
              <Code label={`mcp config · ${MCP_PACKAGE} · node ${MCP_SERVER_PATH}`}>{mcpConfig}</Code>
            </Reveal>
            <Reveal>
              <dl className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line">
                {[
                  ["ELYRION_AGENT_KEY", "Private key of the agent's own wallet, used only to sign write tools. It is never logged or returned. Read tools work without it. Use a dedicated wallet holding only what the agent needs."],
                  ["ELYRION_IDENTITY", "Address of the identity registry (see Contracts)."],
                  ["ELYRION_POOL", "Address of the credit pool (see Contracts)."],
                  ["ELYRION_FROM_BLOCK", "Block the contracts were deployed at. get_loans scans logs from here in 10,000-block ranges; without it the scan starts at block 0 and is slow."],
                ].map(([k, v]) => (
                  <div key={k} className="grid gap-1.5 bg-obsidian-2 p-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
                    <dt className="num text-[12px] text-gold">{k}</dt>
                    <dd className="text-[13.5px] leading-relaxed text-marble/75">{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
            <Reveal>
              <h3 className="stat-key mt-4">Tools</h3>
              <ul className="mt-4 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line">
                {TOOLS.map(([name, args, body]) => (
                  <li key={name} className="grid gap-1.5 bg-obsidian-2 p-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
                    <div className="min-w-0">
                      <code className="num text-[12.5px] text-marble">{name}</code>
                      <p className="num mt-1 text-[11px] break-words text-mute">{args}</p>
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-marble/75">{body}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] leading-relaxed text-mute">
                Write tools return the transaction hash, an explorer link and a short summary.
              </p>
            </Reveal>
          </section>

          {/* Contracts */}
          <section aria-labelledby="contracts" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="contracts">Contracts</H2>
            <Reveal>
              <p className={P}>
                Elysium mainnet, chain ID <span className="num text-marble">99901</span>. Gas is paid in HYPE. RPC{" "}
                <span className="num break-all text-marble">{ELYSIUM_RPC}</span>, explorer{" "}
                <a href={ELYSIUM_EXPLORER} target="_blank" rel="noopener noreferrer" className="num break-all text-gold underline decoration-gold/30 underline-offset-4 hover:text-marble">
                  {ELYSIUM_EXPLORER.replace("https://", "")}
                </a>
                .
              </p>
            </Reveal>
            <Reveal>
              <dl className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line">
                {ADDRESSES.map(([label, addr, note]) => (
                  <div key={label} className="grid gap-1.5 bg-obsidian-2 p-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
                    <dt>
                      <span className="stat-key">{label}</span>
                      <span className="mt-1 block text-[12px] text-mute">{note}</span>
                    </dt>
                    <dd className="num min-w-0 self-center text-[12.5px] break-all">
                      {addr ? (
                        <a href={explorerAddressUrl(addr)} target="_blank" rel="noopener noreferrer" className="text-marble/85 transition-colors duration-500 hover:text-gold">
                          {addr}
                        </a>
                      ) : (
                        <span className="text-mute">Not deployed yet</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </section>

          {/* Score */}
          <section aria-labelledby="score" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="score">The score</H2>
            <Reveal>
              <p className={P}>
                Every agent has a public score from <span className="num text-marble">0</span> to{" "}
                <span className="num text-marble">1000</span>, computed on-chain by the credit pool from four parts:
              </p>
            </Reveal>
            <Reveal>
              <ul className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line">
                {SCORE_ROWS.map((row, i) => (
                  <li key={row} className="flex items-baseline gap-5 bg-obsidian-2 p-4 sm:p-5">
                    <span className="num text-[11px] text-gold">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[14.5px] text-marble/90">{row}</span>
                  </li>
                ))}
                <li className="flex items-baseline gap-5 bg-obsidian p-4 sm:p-5">
                  <span aria-hidden="true" className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-gold" />
                  <strong className="text-[14.5px] font-medium text-gold">{DEFAULT_RULE}</strong>
                </li>
              </ul>
            </Reveal>
            <Reveal>
              <p className="text-[13px] text-mute">{PRIORS_CREDIT}</p>
            </Reveal>
          </section>

          {/* Pre-Score */}
          <section aria-labelledby="prescore" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="prescore">Pre-Score</H2>
            <Reveal>
              <p className={P}>{PRESCORE_INTRO}</p>
            </Reveal>
            <Reveal>
              <div className="overflow-hidden rounded-[14px] border border-line">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Pre-Score parts, maxima and formulas</caption>
                  <thead>
                    <tr className="border-b border-line bg-obsidian">
                      <th scope="col" className="stat-key px-4 py-3 font-medium sm:px-5">Part</th>
                      <th scope="col" className="stat-key px-2 py-3 text-right font-medium">Max</th>
                      <th scope="col" className="stat-key hidden px-4 py-3 font-medium sm:table-cell sm:px-5">Formula</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRESCORE_PARTS.map((r) => (
                      <tr key={r.part} className="border-b border-line bg-obsidian-2 align-top last:border-0">
                        <th scope="row" className="px-4 py-4 text-[14.5px] font-normal text-marble/90 sm:px-5">
                          {r.part}
                          {/* On phones the formula sits under the part name instead of in its own column. */}
                          <span className="num mt-2 block text-[12px] break-words text-gold sm:hidden">{r.formula}</span>
                          {r.note ? <span className="mt-1.5 block text-[12px] leading-relaxed text-mute sm:hidden">{r.note}</span> : null}
                        </th>
                        <td className="num px-2 py-4 text-right text-[14px] text-marble">{r.max}</td>
                        <td className="hidden px-4 py-4 sm:table-cell sm:px-5">
                          <code className="num text-[12.5px] text-gold">{r.formula}</code>
                          {r.note ? <span className="mt-1.5 block text-[12.5px] leading-relaxed text-mute">{r.note}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>
            <Reveal>
              <h3 className="stat-key mt-2">What counts</h3>
              <ul className="mt-4 grid gap-3">
                {PRESCORE_COUNTING_RULE.map((line) => (
                  <li key={line} className="flex items-start gap-3 text-[14px] leading-relaxed text-marble/75">
                    <span aria-hidden="true" className="mt-[9px] h-px w-3 shrink-0 bg-gold/60" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal>
              <h3 className="stat-key mt-2">Tiers</h3>
              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-5">
                {PRESCORE_TIERS.map(([tier, range]) => (
                  <div key={tier} className="bg-obsidian-2 p-4 last:col-span-2 sm:last:col-span-1">
                    <dt className="display text-[22px] italic text-gold">{tier}</dt>
                    <dd className="num mt-1.5 text-[12px] text-marble/70">{range}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
            <Reveal>
              <p className="flex items-start gap-3 rounded-[14px] border border-gold/30 bg-obsidian p-4 text-[14px] leading-relaxed text-marble/90">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                <span>
                  {DISCLAIMER}. Same address, same data, same score: the text on the result page is chosen by fixed
                  templates seeded by the address. Try it at{" "}
                  <Link href="/score" className="text-gold underline decoration-gold/30 underline-offset-4 transition-colors duration-500 hover:text-marble">
                    /score
                  </Link>
                  .
                </span>
              </p>
            </Reveal>
          </section>

          {/* Caps */}
          <section aria-labelledby="caps" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="caps">Caps &amp; fees</H2>
            <Reveal>
              <p className={P}>
                Hard caps are constants in the contracts. The owner can only lower them, never raise them. The fee is
                split 50% to lenders, 25% to the line&apos;s backer and 25% to the reserve.
              </p>
            </Reveal>
            <Reveal>
              <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2">
                {CAPS.map(([k, v]) => (
                  <div key={k} className="bg-obsidian-2 p-4 sm:p-5">
                    <dt className="stat-key">{k}</dt>
                    <dd className="num mt-2 text-[16px] text-marble">{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </section>

          {/* Backers */}
          <section aria-labelledby="backers" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="backers">Backers</H2>
            <Reveal>
              <p className={P}>
                A backer opens an agent&apos;s requested line by locking their own pool shares behind it, and receives a
                quarter of that agent&apos;s loan fees. If the agent defaults, the locked shares are burned to cover the
                principal.
              </p>
            </Reveal>
            <Reveal>
              <p className="flex items-start gap-3 rounded-[14px] border border-gold/30 bg-obsidian p-4 text-[14px] leading-relaxed text-marble/90">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                <span>{BACKER_NOTE}</span>
              </p>
            </Reveal>
          </section>

          {/* API */}
          <section aria-labelledby="api" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="api">Check API</H2>
            <Reveal>
              <p className={P}>
                Before extending credit or trust to an agent, any service can read its record. No key needed; CORS is
                open. Query by agent id or by owner address:
              </p>
            </Reveal>
            <Reveal>
              <Code label="request">{`GET /api/check?agent=1\nGET /api/check?address=0xYourOwnerAddress`}</Code>
            </Reveal>
            <Reveal>
              <Code label="response · example">{checkExample}</Code>
            </Reveal>
            <Reveal>
              <p className="text-[13px] leading-relaxed text-mute">
                <span className="num text-marble/80">lineAmount</span> is USDC with 6 decimals, as a string (
                <span className="num">&quot;5000000&quot;</span> = $5). <span className="num text-marble/80">backer</span>{" "}
                is the active line&apos;s backer (null without a line) and{" "}
                <span className="num text-marble/80">selfBacked</span> is true when that backer is the agent&apos;s
                current owner. Data is cached for up to 15 seconds. If a refresh fails, the last good data is served
                with <span className="num text-marble/80">&quot;stale&quot;: true</span> and its{" "}
                <span className="num text-marble/80">updatedAt</span> time; when nothing has been read yet the API
                answers <span className="num text-marble/80">{`{ "ok": false }`}</span> instead of guessing.
              </p>
            </Reveal>
            <Reveal>
              <p className="flex items-start gap-3 rounded-[14px] border border-gold/30 bg-obsidian p-4 text-[14px] leading-relaxed text-marble/90">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                <span>{SELF_BACKED_NOTE}</span>
              </p>
            </Reveal>
          </section>

          {/* Risk */}
          <section aria-labelledby="risk" className="grid min-w-0 grid-cols-1 gap-6">
            <H2 id="risk">Risk</H2>
            <Reveal>
              <RiskNote className="text-[12px]" />
            </Reveal>
            <Reveal>
              <p className={P}>
                Elyrion is experimental software and the contracts are unaudited. A backer loses its locked shares if the
                agent it backs defaults. Lenders rely on that backing and on the contracts working as written; a bug
                could lose funds. Caps keep every position small. No yield is promised to anyone. Only deposit what you
                can afford to lose.
              </p>
            </Reveal>
          </section>
        </div>
      </div>
    </>
  );
}
