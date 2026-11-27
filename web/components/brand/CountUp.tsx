"use client";

import { useEffect, useRef, useState } from "react";
import { easeGate, prefersReducedMotion } from "@/lib/motion";

export type CountUpProps = {
  /** Target value. When it changes later (e.g. live data arrives) it counts from the shown value. */
  value: number;
  /**
   * Formats the interpolated (unrounded) number. Functions can't cross the
   * Server → Client boundary, so from a Server Component use `decimals` /
   * `prefix` / `suffix` instead.
   */
  format?: (n: number) => string;
  /** Fraction digits for the default en-US formatter. Default 0. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Count duration in seconds. Default 2.2 (mockup). */
  duration?: number;
  /** Delay before the first count, in seconds. Default 0.5 (mockup). */
  delay?: number;
  className?: string;
};

/**
 * JetBrains Mono, tabular figures, counts from 0 when scrolled into view using
 * the global easing. Reduced motion shows the final value immediately. Screen
 * readers always get the final value; the animated digits are aria-hidden.
 */
export function CountUp({
  value,
  format,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 2.2,
  delay = 0.5,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(0);
  const startedRef = useRef(false);
  const [inView, setInView] = useState(false);
  const [display, setDisplay] = useState(0);

  const text = (n: number) =>
    format
      ? format(n)
      : `${prefix}${n.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const reduce = prefersReducedMotion();
    const from = shownRef.current;
    const to = value;
    const total = reduce ? 0 : duration * 1000;
    const wait = reduce || startedRef.current ? 0 : delay * 1000;
    startedRef.current = true;
    const t0 = performance.now() + wait;
    let raf = 0;

    const tick = (now: number) => {
      const p = total === 0 ? 1 : Math.min(1, Math.max(0, (now - t0) / total));
      const v = p === 1 ? to : from + (to - from) * easeGate(p);
      shownRef.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, delay]);

  return (
    <span ref={ref} className={["num", className].filter(Boolean).join(" ")}>
      <span aria-hidden="true">{text(display)}</span>
      <span className="sr-only">{text(value)}</span>
    </span>
  );
}

export default CountUp;
