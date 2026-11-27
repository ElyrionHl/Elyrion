import { ReadingPanel } from "@/components/prescore/ReadingPanel";

/**
 * Shown while the server reads the explorer. No numbers here: the real ones arrive with the result and play in
 * its reading sequence, which uses the same panel in the same place, so nothing jumps when it lands.
 */
export default function Loading() {
  return (
    <section aria-busy="true" className="relative overflow-hidden border-b border-line">
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative grid h-[420px] place-items-center px-4 sm:px-8 md:h-[468px]">
        <div role="status" className="grid w-full place-items-center">
          <ReadingPanel label="Reading Elysium" />
        </div>
      </div>
    </section>
  );
}
