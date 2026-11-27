/** The team pledge: $1,000 USDC (6 decimals). */
export const PLEDGE_USDC = 1_000_000_000n;

export interface PledgeProgress {
  /** Fill of the progress bar, 0–100, in basis-point precision (two decimals). */
  pct: number;
  /** True once the on-chain amount reaches the full pledge. */
  open: boolean;
}

/** Progress toward the pledge from the amount read on-chain (treasuryDeposited). Negative input counts as 0. */
export function pledgeProgress(deposited: bigint, pledge: bigint = PLEDGE_USDC): PledgeProgress {
  const d = deposited < 0n ? 0n : deposited;
  if (pledge <= 0n) return { pct: 100, open: true };
  const bps = d >= pledge ? 10_000n : (d * 10_000n) / pledge;
  return { pct: Number(bps) / 100, open: d >= pledge };
}
