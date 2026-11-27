import Link from "next/link";
import type { ReactNode } from "react";
import { GateLogo } from "./GateLogo";
import { NavLinks, type NavLink } from "./NavLinks";

export const NAV_LINKS: NavLink[] = [
  { href: "/board", label: "Board" },
  { href: "/register", label: "Register" },
  { href: "/docs", label: "Docs" },
  { href: "/lend", label: "Lend" },
];

export type NavProps = {
  /** Right-side slot, e.g. a wallet ConnectButton (Task 8). */
  action?: ReactNode;
  /** Override the primary links. Defaults to Board, Register, Docs, Lend. */
  links?: NavLink[];
  /** Overlay the page (absolute, transparent) instead of sitting in flow. Use over a hero. */
  overlay?: boolean;
  className?: string;
};

/**
 * Site header: Gate mark + ELYRION wordmark, primary links, optional action slot.
 * Below `sm` the links drop to a second row so nothing overflows at 375px.
 */
export function Nav({ action, links = NAV_LINKS, overlay = false, className }: NavProps) {
  return (
    <header
      className={[
        overlay ? "absolute inset-x-0 top-0 z-30" : "relative z-30 border-b border-line",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 py-5 sm:flex-nowrap sm:px-8"
      >
        <Link href="/" className="flex items-center gap-3" aria-label="Elyrion home">
          <GateLogo size={26} />
          <span className="wordmark text-[18px] sm:text-[19px]">ELYRION</span>
        </Link>

        <div className="order-last w-full border-t border-line pt-3 sm:order-none sm:ml-auto sm:w-auto sm:border-0 sm:pt-0">
          <NavLinks links={links} />
        </div>

        {action ? <div className="flex items-center">{action}</div> : null}
      </nav>
    </header>
  );
}

export default Nav;
