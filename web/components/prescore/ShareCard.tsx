"use client";

import { useEffect, useRef, useState } from "react";
import { GateLogo } from "@/components/brand/GateLogo";
import { shortAddr } from "@/lib/format";
import { REDUCED_MOTION_QUERY } from "@/lib/motion";
import { DISCLAIMER } from "@/lib/prescore/constants";
import { cleanOrigin, displayHost, pngFilename, scoreUrl, shareText, xIntentUrl } from "@/lib/prescore/view";

/** Max tilt in degrees on each axis. */
const MAX_TILT = 8;
const ENV_SITE = cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL);

/** The card's ring: same geometry as <ScoreRing> / the OG image, static. */
function CardRing({ total }: { total: number }) {
  const r = 46;
  const frac = Math.min(1, Math.max(0, total / 1000));
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 120 120" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="share-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--gold-deep)" />
          <stop offset="55%" stopColor="var(--gold-2)" />
          <stop offset="100%" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      {Array.from({ length: 10 }, (_, i) => {
        const t = (i / 10) * 2 * Math.PI - Math.PI / 2;
        return (
          <line key={i} x1={60 + 53 * Math.cos(t)} y1={60 + 53 * Math.sin(t)} x2={60 + 55.5 * Math.cos(t)} y2={60 + 55.5 * Math.sin(t)} stroke="var(--line)" strokeWidth={0.6} />
        );
      })}
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth={2.4} />
      {frac > 0 ? (
        <>
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="url(#share-ring)"
            strokeWidth={2.4}
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={`${frac * 1000} 1000`}
            transform="rotate(-90 60 60)"
          />
          <circle cx={60 + r * Math.cos(a)} cy={60 + r * Math.sin(a)} r={4.2} fill="var(--gold)" opacity={0.14} />
          <circle cx={60 + r * Math.cos(a)} cy={60 + r * Math.sin(a)} r={1.9} fill="var(--gold)" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The share card: an HTML twin of the OG image (same layout, scales with its container via cqw units),
 * with a pointer-following 3D tilt (max 8°, global easing; off for coarse pointers and reduced motion),
 * and Share on X / Download PNG / Copy link.
 */
export function ShareCard({ address, total, tier, traits }: { address: string; total: number; tier: string; traits: string[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState(ENV_SITE);
  const [copied, setCopied] = useState(false);
  const [dl, setDl] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    if (ENV_SITE) return;
    const raf = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Tilt: pointer position → CSS variables, written once per frame; CSS does the easing.
  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) return;
    const coarse = window.matchMedia("(pointer: coarse)");
    const reduce = window.matchMedia(REDUCED_MOTION_QUERY);
    let raf = 0;
    let next: { x: number; y: number } | null = null;

    const apply = () => {
      raf = 0;
      if (!next) return;
      const { x, y } = next;
      card.style.setProperty("--ry", `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--rx", `${(-(y - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
      card.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
      card.dataset.tilt = "on";
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || coarse.matches || reduce.matches) return;
      const r = stage.getBoundingClientRect();
      next = {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      next = null;
      cancelAnimationFrame(raf);
      raf = 0;
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
      card.dataset.tilt = "off";
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const url = origin ? scoreUrl(origin, address) : "";
  const xHref = url ? xIntentUrl(shareText(total, tier), url) : undefined;

  const download = async () => {
    setDl("busy");
    try {
      // Same renderer as the og:image; same-origin, so it works whatever metadataBase says.
      const res = await fetch(`/score/${address}/opengraph-image`);
      const blob = await res.blob();
      if (!res.ok || blob.type !== "image/png") throw new Error("not a png");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = pngFilename(address);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setDl("idle");
    } catch {
      setDl("error");
    }
  };

  const copy = async () => {
    const link = url || scoreUrl(window.location.origin, address);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt("Copy this link", link);
    }
  };

  const host = displayHost(origin);

  return (
    <div>
      <div ref={stageRef} className="prescore-stage">
        <div
          ref={cardRef}
          data-tilt="off"
          role="img"
          aria-label={`Pre-Score card: ${shortAddr(address)}, ${total} of 1000, ${tier}${traits.length ? `, ${traits.join(", ")}` : ""}. ${DISCLAIMER}.`}
          className="prescore-card @container relative aspect-[1200/630] w-full overflow-hidden rounded-[18px] border border-line bg-obsidian"
        >
          <div aria-hidden="true" className="flex size-full flex-col px-[5.4cqw] pt-[4.6cqw] pb-[4cqw]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-[1.5cqw]">
                <span className="block size-[3.7cqw] [&>svg]:size-full">
                  <GateLogo size={44} strokeWidth={4} />
                </span>
                <span className="wordmark text-[2.35cqw]">ELYRION</span>
              </span>
              <span className="font-mono text-[1.25cqw] tracking-[0.22em] text-gold">PRE-SCORE · ELYSIUM</span>
            </div>

            <div className="flex flex-1 items-center justify-between gap-[4cqw]">
              <div className="flex min-w-0 flex-col">
                <span className="num text-[1.85cqw] text-mute">{shortAddr(address)}</span>
                <span className="mt-[1.5cqw] font-serif text-[12.3cqw] leading-none tracking-[-0.02em] text-gold italic">{tier}</span>
                {traits.length ? (
                  <span className="mt-[2.8cqw] flex flex-wrap gap-[1cqw]">
                    {traits.map((t) => (
                      <span key={t} className="rounded-full border border-gold/40 px-[1.5cqw] py-[0.75cqw] font-mono text-[1.25cqw] tracking-[0.16em] text-marble/85 uppercase">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
              <div className="relative grid size-[27.5cqw] shrink-0 place-items-center">
                <CardRing total={total} />
                <span className="flex flex-col items-center">
                  <span className="num text-[8.7cqw] leading-none tracking-[-0.04em] text-marble">{total}</span>
                  <span className="mt-[1.2cqw] font-mono text-[1.15cqw] tracking-[0.2em] text-gold">/ 1000</span>
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-[2cqw] border-t border-line pt-[1.8cqw] font-mono text-[1.25cqw] tracking-[0.12em]">
              <span className="text-mute">{DISCLAIMER}</span>
              {host ? <span className="text-gold">{host}</span> : null}
            </div>
          </div>
          <div aria-hidden="true" className="prescore-glare pointer-events-none absolute inset-0" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <a
          href={xHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={xHref ? undefined : true}
          className="btn btn-solid"
        >
          Share on X
        </a>
        <button type="button" className="btn text-marble disabled:cursor-wait disabled:opacity-60" onClick={() => void download()} disabled={dl === "busy"}>
          {dl === "busy" ? "Preparing…" : "Download PNG"}
        </button>
        <button type="button" className="btn text-marble" onClick={() => void copy()}>
          {copied ? "Link copied" : "Copy link"}
        </button>
        <span aria-live="polite" className="font-mono text-[11px] tracking-[0.06em] text-mute">
          {dl === "error" ? "The image could not be prepared. Try again." : copied ? <span className="sr-only">Link copied</span> : null}
        </span>
      </div>
    </div>
  );
}

export default ShareCard;
