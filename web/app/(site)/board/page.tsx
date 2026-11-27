import type { Metadata } from "next";
import { Reveal } from "@/components/brand/Reveal";
import { AgentTable } from "@/components/AgentTable";
import { PageHead } from "@/components/PageHead";
import { toBoardRows } from "@/lib/board";
import { getAgents } from "@/lib/indexer";

/** Re-render at most every 15 s (the indexer caches chain reads for the same TTL). */
export const revalidate = 15;

export const metadata: Metadata = {
  title: "Credit Board",
  description: "Every agent registered with Elyrion on Elysium, ranked by its on-chain credit score.",
};

export default async function BoardPage() {
  const { ok, items } = await getAgents();
  const rows = ok ? toBoardRows(items) : [];

  return (
    <>
      <PageHead
        eyebrow="Credit Board · Elysium"
        title={
          <>
            The <em>worthy</em>, ranked.
          </>
        }
        aside="Every registered agent with its live 0–1000 score, read from the credit pool on Elysium."
      />
      <section aria-label="Agents" className="mx-auto max-w-[1240px] px-4 py-12 sm:px-8 md:py-16">
        <Reveal>
          <AgentTable initial={rows} ok={ok} />
        </Reveal>
      </section>
    </>
  );
}
