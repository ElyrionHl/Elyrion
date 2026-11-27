"use client";

import { useState } from "react";
import { GateLogo } from "@/components/brand/GateLogo";

/** Placeholder-page demo of the GateLogo open state. Removed with the placeholder page (Task 7). */
export function GateDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-7 rounded-[18px] border border-line bg-obsidian-2 px-6 py-10 [background-image:radial-gradient(60%_60%_at_50%_40%,rgba(226,197,139,.08),transparent_70%)]">
      <GateLogo size={104} animated open={open} title="Elyrion gate" />
      <span className="wordmark text-[26px] sm:text-[30px]">ELYRION</span>
      <button
        type="button"
        className="btn"
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close the gate" : "Open the gate"}
      </button>
    </div>
  );
}
