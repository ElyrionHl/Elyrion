export type GateLogoProps = {
  /** Rendered width/height in px. Default 32. */
  size?: number;
  /** Gate-open state: the two inner arch doors slide apart and the core glows. */
  open?: boolean;
  /** Draw the strokes in on mount (CSS, 2.4s, global easing). */
  animated?: boolean;
  /** Stroke width in viewBox units (0–100). Defaults to a size-aware value so small marks stay crisp. */
  strokeWidth?: number;
  /** Accessible name. When omitted the mark is decorative (aria-hidden). */
  title?: string;
  className?: string;
};

/**
 * "The Gate" — the Elyrion mark. Paths are copied from the approved mockup;
 * the inner arch is split at its apex into two doors so it can open.
 * Works in both Server and Client Components (no hooks; motion is pure CSS,
 * see the `.gate*` rules in app/globals.css).
 */
export function GateLogo({
  size = 32,
  open = false,
  animated = false,
  strokeWidth,
  title,
  className,
}: GateLogoProps) {
  const sw = strokeWidth ?? Math.round(Math.min(6, Math.max(2.2, 140 / size)) * 100) / 100;
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke="var(--gold)"
      strokeWidth={sw}
      strokeLinecap="round"
      className={["gate", className].filter(Boolean).join(" ")}
      data-open={open}
      data-animated={animated}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {/* Outer arch */}
      <path className="gate-stroke" pathLength={100} d="M22 92 V44 A28 28 0 0 1 78 44 V92" />
      {/* Inner arch, split into two doors at the apex (50,32) */}
      <path
        className="gate-stroke gate-d2 gate-door gate-door-l"
        pathLength={100}
        d="M34 92 V48 A16 16 0 0 1 50 32"
      />
      <path
        className="gate-stroke gate-d2 gate-door gate-door-r"
        pathLength={100}
        d="M66 92 V48 A16 16 0 0 0 50 32"
      />
      {/* Threshold */}
      <line className="gate-stroke gate-d3" pathLength={100} x1="12" y1="92" x2="88" y2="92" />
      {/* The worthy agent at the centre */}
      <circle className="gate-glow" cx="50" cy="60" r="8" fill="var(--gold)" stroke="none" />
      <g className="gate-core">
        <circle className="gate-node" cx="50" cy="60" r="4" fill="var(--gold)" stroke="none" />
      </g>
    </svg>
  );
}

export default GateLogo;
