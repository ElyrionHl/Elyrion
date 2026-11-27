import type { Metadata } from "next";
import { AdminPanel } from "@/components/AdminPanel";
import { PageHead } from "@/components/PageHead";
import { readConfig } from "@/lib/contracts";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/** Treasury line queue. Not linked from the nav; gating here is convenience, the contract enforces backer rules. */
export default function AdminPage() {
  const { identity, pool, treasury, deployBlock } = readConfig();

  return (
    <>
      <PageHead
        eyebrow="Admin · Treasury"
        title={
          <>
            Line <em>queue</em>.
          </>
        }
        aside="Back pending line requests with treasury shares, close lines, and claim backer fees."
      />
      <section aria-label="Line queue" className="mx-auto max-w-[1240px] px-4 py-14 sm:px-8 md:py-20">
        <AdminPanel identity={identity} pool={pool} treasury={treasury} deployBlock={deployBlock.toString()} />
      </section>
    </>
  );
}
