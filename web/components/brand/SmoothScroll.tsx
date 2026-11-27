"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { REDUCED_MOTION_QUERY } from "@/lib/motion";

/**
 * Mounts Lenis smooth scrolling driven by the GSAP ticker and keeps
 * ScrollTrigger in sync, so later GSAP scroll animations just work.
 * Never mounts (and tears down live) under prefers-reduced-motion.
 * Renders nothing; place once in the root layout.
 */
export function SmoothScroll() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    let lenis: Lenis | null = null;

    const raf = (time: number) => lenis?.raf(time * 1000);

    const start = () => {
      if (lenis || mq.matches) return;
      lenis = new Lenis({ lerp: 0.1, anchors: true, stopInertiaOnNavigate: true });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
    };

    const stop = () => {
      if (!lenis) return;
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenis = null;
    };

    const onChange = () => (mq.matches ? stop() : start());

    start();
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      stop();
    };
  }, []);

  return null;
}

export default SmoothScroll;
