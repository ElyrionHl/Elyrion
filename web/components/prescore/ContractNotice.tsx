import Link from "next/link";
import { Reveal } from "@/components/brand/Reveal";
import { explorerAddressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/** A contract address gets a notice, never a score. */
export function ContractNotice({ address }: { address: string }) {
  return (
    <section aria-labelledby="prescore-contract" className="relative overflow-hidden border-b border-line">
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1240px] px-4 pt-14 pb-20 sm:px-8 md:pt-20 md:pb-28">
        <Reveal>
          <p className="eyebrow">
            <Link href="/score" className="transition-colors duration-500 hover:text-marble">
              Pre-Score
            </Link>{" "}
            ·{" "}
            <a
              href={explorerAddressUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              title={address}
              className="num tracking-[0.08em] normal-case transition-colors duration-500 hover:text-marble"
            >
              {shortAddr(address)} ↗
            </a>
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 id="prescore-contract" tabIndex={-1} className="display mt-4 text-[44px] sm:text-[64px]">
            Pre-Score is for <em>wallets</em>.
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-[560px] text-[15px] leading-relaxed text-marble/80">
            This address holds contract code on Elysium. A Pre-Score reads the footsteps of a wallet, so contracts are
            not scored. Paste the wallet that uses it instead.
          </p>
        </Reveal>
        <Reveal delay={0.24} className="mt-8 flex flex-wrap gap-2.5">
          <Link href="/score" className="btn btn-solid">
            Read a wallet
          </Link>
          <a href={explorerAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="btn text-marble">
            View on explorer ↗
          </a>
        </Reveal>
      </div>
    </section>
  );
}

export default ContractNotice;
