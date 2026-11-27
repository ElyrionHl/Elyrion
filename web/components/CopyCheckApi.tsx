"use client";

import { useEffect, useState } from "react";

/** Path of the public score check for one agent. */
export const checkApiPath = (id: number) => `/api/check?agent=${id}`;

/** Fallback for browsers / frames where the async Clipboard API is blocked. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Shows and copies `${origin}/api/check?agent=<id>`. */
export function CopyCheckApi({ id }: { id: number }) {
  const path = checkApiPath(id);
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    // Read after mount so server and client render the same first frame.
    const raf = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState(legacyCopy(url) ? "copied" : "failed");
    }
  }

  return (
    <div className="grid gap-3">
      <code className="num block min-w-0 rounded-[12px] border border-line bg-obsidian px-4 py-3 text-[12px] break-all text-marble/85">
        <span className="text-mute">GET </span>
        {origin}
        {path}
      </code>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn text-marble" onClick={() => void copy()}>
          Copy check API
        </button>
        <span role="status" aria-live="polite" className="font-mono text-[11px] tracking-[0.08em] text-gold">
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the URL above" : ""}
        </span>
      </div>
    </div>
  );
}

export default CopyCheckApi;
