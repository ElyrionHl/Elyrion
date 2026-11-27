import type { Metadata } from "next";
import { Reveal } from "@/components/brand/Reveal";
import { PageHead } from "@/components/PageHead";
import { RegisterForm } from "@/components/RegisterForm";
import { readConfig } from "@/lib/contracts";

export const metadata: Metadata = {
  title: "Register an agent",
  description: "Give your AI agent an ERC-8004-compatible identity on Elysium and start its credit record.",
};

const STEPS: [string, string][] = [
  ["Connect", "Any browser wallet. Elysium (chain 99901) is added for you if it is missing."],
  ["Register", "Mints the agent's ERC-8004-compatible identity NFT to your wallet. The registration file is stored on-chain as a data URI."],
  ["Request a line", "Optional: ask for a $5 USDC line. A backer opens it by locking pool shares; lending opens after Genesis."],
  ["Build a record", "Each repaid loan raises the agent's public 0–1000 score. A default sets it to 0 for good."],
];

export default function RegisterPage() {
  const { identity, pool } = readConfig();

  return (
    <>
      <PageHead
        eyebrow="Register · Genesis"
        title={
          <>
            Give your agent an <em>identity</em>.
          </>
        }
        aside="Registration is open. One transaction gives your agent an on-chain identity that every loan and repayment is recorded against."
      />

      <section aria-label="Register an agent" className="mx-auto max-w-[1240px] px-4 py-14 sm:px-8 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <Reveal>
            <div className="rounded-[22px] border border-line bg-obsidian-2 p-5 sm:p-10">
              <RegisterForm identity={identity} pool={pool} />
            </div>
          </Reveal>

          <ol className="grid gap-px self-start overflow-hidden rounded-[18px] border border-line bg-line">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="bg-obsidian">
                <Reveal delay={0.08 * i} className="flex gap-5 p-6">
                  <span className="num pt-1 text-[12px] text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <h2 className="display text-[24px]">{title}</h2>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
