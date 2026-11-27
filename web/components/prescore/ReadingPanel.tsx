import type { CSSProperties } from "react";

/**
 * The reading block shared by the loading state and the result's reading sequence, so the hand-off between
 * them does not move. Without `lines` it is the loading state: three empty line slots and an indeterminate
 * hairline sweep (no numbers until real ones exist). With `lines`, the lines step in at `step`.
 */
export function ReadingPanel({ label, lines, step = -1 }: { label: string; lines?: readonly string[]; step?: number }) {
  const slots = lines ?? ["", "", ""];
  return (
    <div className="w-full max-w-[420px]">
      <p className="stat-key flex items-center gap-2.5">
        <span aria-hidden="true" className="live-dot" />
        {label}
      </p>
      <ol aria-hidden="true" className="mt-5 grid gap-2.5">
        {slots.map((line, i) => (
          <li
            key={i}
            data-state={step > i ? "past" : step === i ? "now" : "next"}
            className="prescore-line num min-h-[1.5em] text-[12px] tracking-[0.16em] text-marble sm:text-[13px]"
          >
            {line}
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className={`mt-6 h-px w-full overflow-hidden bg-line${lines ? "" : " prescore-scan"}`}>
        {lines ? (
          <div className="prescore-progress h-px bg-gold" style={{ "--p": `${((step + 1) / slots.length) * 100}%` } as CSSProperties} />
        ) : (
          <div className="h-px w-1/3 bg-gold" />
        )}
      </div>
    </div>
  );
}

export default ReadingPanel;
