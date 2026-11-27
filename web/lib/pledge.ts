import { formatUsdc } from "./format";

/** The team pledge: $1,000 USDC (6 decimals). */
export const PLEDGE_USDC = 1_000_000_000n;

/** Fixed pledge copy (copy rules). */
export const PLEDGE_AMOUNT = "$1,000";
export const PLEDGE_UNIT = "USDC";
export const PLEDGE_LINE = "pledged by the Elyrion team to the treasury";
export const PLEDGE_SOURCE =
  "Read live from the credit pool on Elysium: the USDC principal the treasury wallet has deposited (depositedOf).";

export interface PledgeProgress {
  /** Fill of the progress bar, 0–100, in basis-point precision (two decimals). */
  pct: number;
  /** True once the on-chain amount reaches the full pledge. */
  open: boolean;
}

/**
 * Progress toward the pledge from the amount read on-chain: pool.depositedOf(treasury), the net USDC principal
 * the treasury deposited. Negative input counts as 0.
 */
export function pledgeProgress(deposited: bigint, pledge: bigint = PLEDGE_USDC): PledgeProgress {
  const d = deposited < 0n ? 0n : deposited;
  if (pledge <= 0n) return { pct: 100, open: true };
  const bps = d >= pledge ? 10_000n : (d * 10_000n) / pledge;
  return { pct: Number(bps) / 100, open: d >= pledge };
}

export interface PledgeView {
  isOpen: boolean;
  pct: number;
  /** "$X" read live, or "—" when the chain could not be read. */
  amount: string;
  /** "Deposited on-chain: $X / $1,000". */
  progressText: string;
  pctText: string;
  statusText: string;
  /** For aria-valuenow; undefined when unknown. */
  dollars: number | undefined;
}

/** Everything PledgeGate renders, from the on-chain amount. The Gate opens only at >= $1,000 read on-chain. */
export function pledgeView(deposited: bigint, ok: boolean): PledgeView {
  const { pct, open } = pledgeProgress(ok ? deposited : 0n);
  const isOpen = ok && open;
  const amount = ok ? formatUsdc(deposited < 0n ? 0n : deposited) : "—";
  return {
    isOpen,
    pct: ok ? pct : 0,
    amount,
    progressText: `Deposited on-chain: ${amount} / ${PLEDGE_AMOUNT}`,
    pctText: ok ? `${pct.toFixed(2)}%` : "—",
    statusText: isOpen
      ? "The Gate is open"
      : ok
        ? "The Gate opens when the full pledge is on-chain."
        : "Live chain data is unavailable right now.",
    dollars: ok ? Number((deposited < 0n ? 0n : deposited) / 10_000n) / 100 : undefined,
  };
}
