import type { ReactNode } from "react";
import { Reveal } from "@/components/brand/Reveal";

/** Page header for inner pages (board, register, agent, docs): eyebrow, serif title, optional aside. */
export function PageHead({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[1240px] flex-col gap-6 px-4 pt-14 pb-10 sm:px-8 md:flex-row md:items-end md:justify-between md:gap-10 md:pt-20 md:pb-14">
        <div className="min-w-0">
          <Reveal>
            <p className="eyebrow">{eyebrow}</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="display mt-4 text-[44px] break-words sm:text-[64px] lg:text-[76px]">{title}</h1>
          </Reveal>
        </div>
        {aside ? (
          <Reveal delay={0.16} className="md:max-w-[420px]">
            <div className="text-[13.5px] leading-relaxed text-mute md:text-right">{aside}</div>
          </Reveal>
        ) : null}
      </div>
      {children}
    </header>
  );
}

export default PageHead;
