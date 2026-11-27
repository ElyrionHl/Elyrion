import { Footer, type FooterAddress } from "@/components/brand/Footer";
import { Nav } from "@/components/brand/Nav";
import { SmoothScroll } from "@/components/brand/SmoothScroll";
import { explorerAddressUrl } from "@/lib/chain";
import { readConfig } from "@/lib/contracts";

/** Configured contract addresses for the footer. Unset ones are left out. */
function footerAddresses(): FooterAddress[] {
  const { identity, pool, treasury } = readConfig();
  const rows: [string, string | undefined][] = [
    ["Identity registry", identity],
    ["Credit pool", pool],
    ["Treasury wallet", treasury],
  ];
  return rows
    .filter((r): r is [string, string] => !!r[1])
    .map(([label, value]) => ({ label, value, href: explorerAddressUrl(value) }));
}

/**
 * Shared chrome for every public page (landing, board, agent, docs, lend…).
 * On a page with a full-bleed hero (`[data-hero]`), the nav overlays it; see
 * `.site-shell:has([data-hero])` in globals.css.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="site-shell relative flex min-h-dvh flex-1 flex-col">
      <SmoothScroll />
      <Nav className="site-nav" />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer addresses={footerAddresses()} />
    </div>
  );
}
