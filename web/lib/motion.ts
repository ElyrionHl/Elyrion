/**
 * Elyrion motion primitives. There is exactly one easing curve in the system:
 * cubic-bezier(0.32, 0.72, 0, 1). CSS uses `var(--ease)` / the `ease-gate`
 * utility; JS (rAF loops, GSAP tweens) uses `easeGate` below.
 */

export const EASE_CSS = "cubic-bezier(0.32,0.72,0,1)";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Builds a JS easing function equivalent to CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number) => {
    // Newton-Raphson first, bisection as a fallback.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < 1e-7) break;
    }
    return t;
  };

  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return sampleY(solveT(p));
  };
}

/** The global Elyrion easing as a JS function (usable as a GSAP `ease`). */
export const easeGate = cubicBezier(0.32, 0.72, 0, 1);

/** True when the user asked for reduced motion. Safe to call during SSR (returns false). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
