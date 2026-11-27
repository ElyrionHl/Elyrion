"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

/** Primary links with a gold hairline underline; marks the current route with aria-current. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end sm:gap-8">
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "group relative inline-block py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors duration-500",
                active ? "text-gold" : "text-marble/70 hover:text-marble",
              ].join(" ")}
            >
              {label}
              <span
                aria-hidden="true"
                className={[
                  "absolute inset-x-0 -bottom-px h-px origin-left bg-gold transition-transform duration-700",
                  active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                ].join(" ")}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default NavLinks;
