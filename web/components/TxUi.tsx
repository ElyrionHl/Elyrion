import type { ReactNode } from "react";
import type { Hash } from "viem";
import { explorerTxUrl } from "@/lib/chain";

/** Explorer link for a transaction ("Deposit tx ↗"). */
export function TxLink({ hash, children }: { hash: Hash; children: ReactNode }) {
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="num inline-flex items-center gap-1.5 text-[12.5px] text-gold underline decoration-gold/40 underline-offset-4 transition-colors duration-500 hover:text-marble hover:decoration-marble/60"
    >
      {children} ↗
    </a>
  );
}

/** Neutral inline note (not configured, gated, paused…). */
export function Note({ children, role }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div
      role={role}
      className="flex items-start gap-3 rounded-[14px] border border-line bg-obsidian p-4 text-[13px] leading-relaxed text-marble/85"
    >
      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** Error box with an optional action (e.g. Switch to Elysium). */
export function ErrorNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[14px] border border-gold/30 bg-obsidian p-4 text-[13px] leading-relaxed text-marble/90"
    >
      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** A key/value cell for stat grids. */
export function StatCell({ k, children, sub }: { k: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-obsidian-2 p-4 sm:p-5">
      <dt className="stat-key">{k}</dt>
      <dd className="num mt-2 min-w-0 truncate text-[18px] text-marble sm:text-[22px]">{children}</dd>
      {sub ? <dd className="mt-1 text-[11.5px] leading-snug text-mute">{sub}</dd> : null}
    </div>
  );
}
