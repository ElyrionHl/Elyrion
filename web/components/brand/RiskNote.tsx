export const RISK_NOTE_TEXT = "Experimental · unaudited · caps in place";

/** The mandatory risk line. Text is fixed by the copy rules; do not change it. */
export function RiskNote({ className }: { className?: string }) {
  return (
    <p
      className={[
        "inline-flex items-center gap-2.5 font-mono text-[11px] tracking-[0.08em] text-mute",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-gold" />
      {RISK_NOTE_TEXT}
    </p>
  );
}

export default RiskNote;
