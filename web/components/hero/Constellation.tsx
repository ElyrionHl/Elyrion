"use client";

import { useEffect, useRef } from "react";
import type { LiveEvent } from "@/lib/live-events";
import { easeGate, REDUCED_MOTION_QUERY } from "@/lib/motion";

export type ConstellationProps = {
  /**
   * Real Borrowed/Repaid events to light up, oldest first. Each event object is
   * pulsed once, when it first appears in this array. Empty = ambient only.
   */
  pulses: LiveEvent[];
  className?: string;
};

type Pt = { x: number; y: number; vx: number; vy: number; r: number; tw: number };
type Pulse = { from: number; to: number; t: number; repaid: boolean };

const LINK_DIST = 110;
const TRAVEL_MS = 1700;
const FADE_MS = 900;
/** Delay between pulses that arrive together, so a batch reads as a sequence. */
const STAGGER_MS = 650;

/** Deterministic PRNG so the field is identical between resizes (no reshuffle jump). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The "Obsidian Constellation" hero canvas, ported from the approved mockup.
 *
 * Honesty rule: the field (points + dim proximity links) is ambient decoration.
 * A bright gold pulse is drawn ONLY for a real on-chain event passed in `pulses`:
 * `Borrowed` travels from the pool (the bright anchor star) out to the agent's
 * star, `Repaid` travels from the agent's star back to the pool. No events, no pulses.
 *
 * Pauses while off-screen or the tab is hidden, renders one still frame under
 * prefers-reduced-motion (no pulses), and is devicePixelRatio-aware. It is
 * absolutely positioned by the parent, so it never causes layout shift.
 */
export function Constellation({ pulses, className }: ConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Pulses queued by props, consumed by the draw loop. */
  const queueRef = useRef<{ ev: LiveEvent; at: number }[]>([]);
  const queuedRef = useRef(new WeakSet<LiveEvent>());
  const kickRef = useRef<() => void>(() => {});

  // Queue newly seen event objects.
  useEffect(() => {
    const now = performance.now();
    let i = 0;
    for (const ev of pulses) {
      if (queuedRef.current.has(ev)) continue;
      queuedRef.current.add(ev);
      queueRef.current.push({ ev, at: now + 600 + i * STAGGER_MS });
      i++;
    }
    if (i > 0) kickRef.current();
  }, [pulses]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    let reduce = mq.matches;
    let W = 0;
    let H = 0;
    let pts: Pt[] = [];
    let anchor = 0;
    let active: Pulse[] = [];
    let raf = 0;
    let visible = true;
    let last = performance.now();

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Same seed every time: points keep their relative place across resizes.
      const rand = mulberry32(0xe1e1);
      const narrow = W < 768;
      const n = narrow ? 42 : 70;
      if (n !== pts.length) active = []; // star indices change with the field size
      const x0 = narrow ? 0.04 : 0.42;
      pts = Array.from({ length: n }, () => ({
        x: W * x0 + rand() * W * (1 - x0 - 0.02),
        y: H * 0.04 + rand() * H * 0.92,
        vx: (rand() - 0.5) * 0.12,
        vy: (rand() - 0.5) * 0.12,
        r: rand() * 1.6 + 0.6,
        tw: rand() * Math.PI * 2,
      }));
      // The pool: a fixed, slightly larger star in the middle of the field.
      anchor = 0;
      pts[0].x = narrow ? W * 0.72 : W * 0.68;
      pts[0].y = narrow ? H * 0.2 : H * 0.42;
      pts[0].vx = 0;
      pts[0].vy = 0;
      pts[0].r = 2.6;
    };

    const starFor = (agentId: number) => 1 + (((agentId * 2654435761) >>> 0) % (pts.length - 1));

    const xMin = () => (W < 768 ? 0 : W * 0.38);

    const draw = (dt: number, now: number) => {
      ctx.clearRect(0, 0, W, H);
      const step = Math.min(dt, 50) / 16.67;

      if (!reduce) {
        for (const p of pts) {
          p.x += p.vx * step;
          p.y += p.vy * step;
          if (p.x < xMin() || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
          p.tw += 0.03 * step;
        }
      }

      // Ambient: dim proximity links only.
      ctx.lineWidth = 0.6;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > LINK_DIST || Math.abs(dy) > LINK_DIST) continue;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(226,197,139,${(1 - d / LINK_DIST) * 0.13})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Real events only. Under reduced motion they are dropped, not replayed later.
      if (reduce) queueRef.current.length = 0;
      else {
        const q = queueRef.current;
        while (q.length && q[0].at <= now) {
          const { ev } = q.shift()!;
          const star = starFor(ev.agentId);
          active.push(
            ev.kind === "Repaid"
              ? { from: star, to: anchor, t: 0, repaid: true }
              : { from: anchor, to: star, t: 0, repaid: false },
          );
        }
        active = active.filter((l) => l.t < TRAVEL_MS + FADE_MS);
        for (const l of active) {
          l.t += Math.min(dt, 50);
          const a = pts[l.from];
          const b = pts[l.to];
          const p = easeGate(Math.min(1, l.t / TRAVEL_MS));
          const fade = l.t > TRAVEL_MS ? 1 - (l.t - TRAVEL_MS) / FADE_MS : 1;
          const ex = a.x + (b.x - a.x) * p;
          const ey = a.y + (b.y - a.y) * p;
          const g = ctx.createLinearGradient(a.x, a.y, ex, ey);
          g.addColorStop(0, "rgba(226,197,139,0)");
          g.addColorStop(1, `rgba(255,226,170,${0.9 * fade})`);
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,236,190,${fade})`;
          ctx.beginPath();
          ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
          ctx.fill();
          // Arrival ring on the target star.
          if (l.t > TRAVEL_MS * 0.85) {
            const k = Math.min(1, (l.t - TRAVEL_MS * 0.85) / (FADE_MS + TRAVEL_MS * 0.15));
            ctx.strokeStyle = `rgba(255,226,170,${0.55 * (1 - k)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(b.x, b.y, 3 + easeGate(k) * (l.repaid ? 16 : 11), 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const alpha = i === anchor ? 0.95 : 0.45 + Math.sin(p.tw) * 0.35;
        ctx.fillStyle = `rgba(232,208,156,${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pts[anchor]) {
        const a = pts[anchor];
        const glow = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 18);
        glow.addColorStop(0, "rgba(226,197,139,0.28)");
        glow.addColorStop(1, "rgba(226,197,139,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 18, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const running = () => visible && !reduce && document.visibilityState === "visible";

    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      draw(dt, now);
      raf = running() ? requestAnimationFrame(loop) : 0;
    };

    const start = () => {
      if (raf) return;
      if (running()) {
        last = performance.now();
        // Pulses that came due while paused play in sequence, not all at once.
        let i = 0;
        for (const item of queueRef.current) {
          if (item.at < last) item.at = last + 300 + i++ * STAGGER_MS;
        }
        raf = requestAnimationFrame(loop);
      } else {
        // Still frame (reduced motion / off-screen / hidden tab): draw once.
        draw(0, performance.now());
      }
    };
    kickRef.current = start;

    layout();
    start();

    const ro = new ResizeObserver(() => {
      layout();
      if (!raf) draw(0, performance.now());
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);

    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    const onMq = () => {
      reduce = mq.matches;
      if (reduce) active = [];
      start();
    };
    mq.addEventListener("change", onMq);

    canvas.dataset.ready = "true";

    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMq);
      kickRef.current = () => {};
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={["constellation pointer-events-none absolute inset-0 h-full w-full", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export default Constellation;
