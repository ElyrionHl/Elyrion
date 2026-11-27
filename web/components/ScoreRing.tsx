"use client";

import { useEffect, useId, useRef, useState } from "react";
import { easeGate, prefersReducedMotion } from "@/lib/motion";

export const SCORE_MAX = 1000;

export type ScoreRingProps = {
  /** 0–1000. Clamped. */
  score: number;
  /** Rendered size in px. Default 240. */
  size?: number;
  /** Fill duration in seconds. Default 2.2 (matches CountUp). */
  duration?: number;
  /** Delay before the fill, in seconds. Default 0.4. */
  delay?: number;
  /** Small caption under the number. */
  label?: string;
};

const clamp = (n: number) => Math.min(SCORE_MAX, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Gold ring that fills 0 → score/1000 with the global easing once in view,
 * with the number counting in step. SSR and reduced motion show the final
 * state (static). Screen readers get "Score N of 1000".
 */
export function ScoreRing({ score, size = 240, duration = 2.2, delay = 0.4, label = "Score / 1000" }: ScoreRingProps) {
  const target = clamp(score);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [value, setValue] = useState(target);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    let t0 = 0;
    let started = false;
    const tick = (now: number) => {
      if (!t0) t0 = now + delay * 1000;
      const p = Math.min(1, Math.max(0, (now - t0) / (duration * 1000)));
      setValue(p >= 1 ? target : target * easeGate(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    // Drop to 0 on the next frame, then fill when the ring enters the viewport.
    raf = requestAnimationFrame(() => {
      if (!started) setValue(0);
    });
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started) return;
        started = true;
        io.disconnect();
        cancelAnimationFrame(raf);
        setValue(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);

  const r = 46;
  const frac = value / SCORE_MAX;
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  const hx = 60 + r * Math.cos(angle);
  const hy = 60 + r * Math.sin(angle);

  return (
    <figure className="relative m-0 inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg
        ref={ref}
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={`Score ${target} of ${SCORE_MAX}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={`sr-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--gold-deep)" />
            <stop offset="55%" stopColor="var(--gold-2)" />
            <stop offset="100%" stopColor="var(--gold)" />
          </linearGradient>
        </defs>
        {/* Tick marks every 100 points */}
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * 2 * Math.PI - Math.PI / 2;
          return (
            <line
              key={i}
              x1={60 + 53 * Math.cos(a)}
              y1={60 + 53 * Math.sin(a)}
              x2={60 + 55.5 * Math.cos(a)}
              y2={60 + 55.5 * Math.sin(a)}
              stroke="var(--line)"
              strokeWidth={0.6}
            />
          );
        })}
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth={2.4} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={`url(#sr-${gid})`}
          strokeWidth={2.4}
          strokeLinecap="round"
          pathLength={SCORE_MAX}
          strokeDasharray={`${value} ${SCORE_MAX}`}
          transform="rotate(-90 60 60)"
          opacity={value > 0 ? 1 : 0}
        />
        {value > 0 ? (
          <>
            <circle cx={hx} cy={hy} r={4.2} fill="var(--gold)" opacity={0.14} />
            <circle cx={hx} cy={hy} r={1.9} fill="var(--gold)" />
          </>
        ) : null}
      </svg>
      <figcaption aria-hidden="true" className="absolute inset-0 grid place-items-center text-center">
        <span>
          <span className="num block leading-none text-marble" style={{ fontSize: size * 0.26 }}>
            {Math.round(value)}
          </span>
          <span className="stat-key mt-3 block">{label}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export default ScoreRing;
