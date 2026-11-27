"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

export type RevealProps = {
  children: ReactNode;
  /** Delay before the entrance, in seconds (mockup staggers by ~0.12s). */
  delay?: number;
  /** Element to render. Default "div"; "span" renders inline-block so the transform applies. */
  as?: ElementType;
  className?: string;
  /** Reveal only the first time it enters the viewport (default true). */
  once?: boolean;
};

/**
 * Blur-to-sharp entrance (opacity 0 → 1, blur 14px → 0, y 18px → 0, 1.4s, global easing),
 * triggered when the element enters the viewport. Styling lives in app/globals.css
 * (`[data-reveal]`); under prefers-reduced-motion the content is shown immediately,
 * and a <noscript> rule in the root layout shows it when JS is off.
 */
export function Reveal({ children, delay = 0, as, className, once = true }: RevealProps) {
  const Tag: ElementType = as ?? "div";
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          if (once) io.disconnect();
        } else if (!once) {
          setShown(false);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const classes = [Tag === "span" ? "inline-block" : null, className].filter(Boolean).join(" ");

  return (
    <Tag
      ref={ref}
      data-reveal={shown ? "in" : "pending"}
      className={classes || undefined}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
