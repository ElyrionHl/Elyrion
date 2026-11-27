import { CountUp } from "@/components/brand/CountUp";
import { Footer } from "@/components/brand/Footer";
import { Nav } from "@/components/brand/Nav";
import { Reveal } from "@/components/brand/Reveal";
import { GateDemo } from "./_preview/GateDemo";

/**
 * Placeholder home: a design-system preview so the build renders something.
 * Task 7 replaces this with the real landing (app/(site)/page.tsx) — delete this
 * file and app/_preview/ then, since both would map to "/".
 */
export default function Home() {
  return (
    <>
      <Nav />
      <main className="relative flex-1 overflow-hidden">
        <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1240px] gap-14 px-4 pt-16 pb-24 sm:px-8 md:grid-cols-[1.2fr_1fr] md:items-center md:pt-24">
          <div>
            <p className="eyebrow">Design system preview · Elysium</p>
            <h1 className="display mt-4 text-[44px] sm:text-[66px]">
              <Reveal as="span" delay={0.1}>
                Only&nbsp;the
              </Reveal>{" "}
              <Reveal as="span" delay={0.22}>
                <em>worthy</em>
              </Reveal>
              <br />
              <Reveal as="span" delay={0.34}>
                enter&nbsp;Elysium.
              </Reveal>
            </h1>
            <Reveal delay={0.5}>
              <p className="mt-5 max-w-[420px] text-[15px] leading-relaxed text-mute">
                Credit &amp; reputation layer for AI agents on Elysium. Brand components: Gate
                mark, blur reveal, count-up and mono labels.
              </p>
            </Reveal>

            <dl className="mt-12 grid grid-cols-3 gap-4 sm:gap-8">
              <div>
                <dt className="stat-key">Max score</dt>
                <dd className="mt-1.5 text-[20px] sm:text-[28px]">
                  <CountUp value={1000} />
                </dd>
              </div>
              <div>
                <dt className="stat-key">Wallet cap</dt>
                <dd className="mt-1.5 text-[20px] sm:text-[28px]">
                  <CountUp value={1000} prefix="$" />
                </dd>
              </div>
              <div>
                <dt className="stat-key">Pool cap</dt>
                <dd className="mt-1.5 text-[20px] sm:text-[28px]">
                  <CountUp value={10000} prefix="$" />
                </dd>
              </div>
            </dl>
          </div>

          <GateDemo />
        </div>
      </main>
      <Footer />
    </>
  );
}
