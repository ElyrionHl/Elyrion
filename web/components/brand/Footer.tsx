import Link from "next/link";
import type { ReactNode } from "react";
import { GateLogo } from "./GateLogo";
import { RiskNote } from "./RiskNote";

export type FooterAddress = {
  /** e.g. "Identity registry", "Credit pool", "Treasury". */
  label: string;
  /** Full address (shown in full, mono, wraps on small screens). */
  value: string;
  /** Optional explorer link. */
  href?: string;
};

export type FooterProps = {
  /** Contract addresses to list. Omit/empty to hide the block. */
  addresses?: FooterAddress[];
  /** Extra content rendered under the addresses. */
  children?: ReactNode;
  className?: string;
};

/** Site footer: brand, RiskNote, contract addresses slot. */
export function Footer({ addresses = [], children, className }: FooterProps) {
  return (
    <footer className={["border-t border-line", className].filter(Boolean).join(" ")}>
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1fr_auto] md:gap-16">
        <div className="flex flex-col gap-5">
          <Link href="/" className="flex w-fit items-center gap-3" aria-label="Elyrion home">
            <GateLogo size={22} />
            <span className="wordmark text-[16px]">ELYRION</span>
          </Link>
          <RiskNote />
        </div>

        {addresses.length > 0 ? (
          <dl className="grid min-w-0 gap-4 md:max-w-[520px]">
            {addresses.map(({ label, value, href }) => (
              <div key={`${label}-${value}`} className="grid min-w-0 gap-1">
                <dt className="stat-key">{label}</dt>
                <dd className="num min-w-0 break-all text-[12px] text-marble/80">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors duration-500 hover:text-gold"
                    >
                      {value}
                    </a>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {children ? <div className="md:col-span-2">{children}</div> : null}
      </div>

      <div className="border-t border-line">
        <p className="mx-auto max-w-[1240px] px-4 py-5 font-mono text-[10px] uppercase tracking-[0.2em] text-mute sm:px-8">
          © {new Date().getFullYear()} Elyrion · Elysium
        </p>
      </div>
    </footer>
  );
}

export default Footer;
