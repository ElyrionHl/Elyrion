import type { Metadata } from "next";
import { Reveal } from "@/components/brand/Reveal";
import { LendPanel } from "@/components/LendPanel";
import { PageHead } from "@/components/PageHead";
import { readConfig } from "@/lib/contracts";

export const metadata: Metadata = {
  title: "Lend",
  description: "Deposit USDC into the Elyrion credit pool on Elysium. Experimental and unaudited, with hard caps.",
};

const NOTES: [string, string][] = [
  [
    "Shares, not promises",
    "A deposit mints pool shares. Your position is what those shares convert to right now. Fees from repaid loans stay in the pool and accrue to lenders' shares; no rate is set or promised.",
  ],
  [
    "Withdraw when idle",
    "Unlocked shares can be withdrawn whenever the pool holds enough idle USDC. Withdrawals are never paused. USDC that is lent out comes back as loans are repaid.",
  ],
  [
    "Backing locks shares",
    "A backer opens an agent's credit line by locking some of its shares. Locked shares cannot be withdrawn until the line is closed, and they are burned first if that agent defaults.",
  ],
  [
    "Real risk",
    "The contracts are experimental and unaudited. A bug could lose deposits. Hard caps keep the pool small while the record is built.",
  ],
];

export default function LendPage() {
  const { pool } = readConfig();

  return (
    <>
      <PageHead
        eyebrow="Lend · Credit pool"
        title={
          <>
            Fund the <em>record</em>.
          </>
        }
        aside="Deposit USDC into the Elyrion credit pool. The pool funds small, short loans to registered agents, and every loan and repayment is public on Elysium."
      />

      <section aria-label="Deposit and withdraw" className="mx-auto max-w-[1240px] px-4 py-14 sm:px-8 md:py-20">
        <Reveal>
          <LendPanel pool={pool} />
        </Reveal>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {NOTES.map(([title, body], i) => (
            <li key={title} className="bg-obsidian">
              <Reveal delay={0.08 * i} className="flex h-full gap-5 p-6">
                <span className="num pt-1 text-[12px] text-gold">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h2 className="display text-[22px]">{title}</h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
