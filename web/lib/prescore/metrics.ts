import { DAY_SEC, MAX_TXS, USDC_ADDRESS } from "./constants";

export type ExplorerTx = { hash: string; from: string; to: string; timeStamp: string; isError: string; blockNumber: string };
export type ExplorerTokenTx = { contractAddress: string; from: string; to: string; timeStamp: string };
export type RawActivity = { firstTx: ExplorerTx | null; recentTxs: ExplorerTx[]; tokenTxs: ExplorerTokenTx[] };
export type Metrics = {
  ageDays: number;
  firstBlock: number | null;
  firstTs: number | null;
  txCount: number;
  txCapped: boolean;
  activeDays: number;
  distinctContracts: number;
  distinctTokens: number;
  usdcTransfers: number;
  /** Share (0..1) of counted txs that fall on the 2 busiest UTC days. */
  busiestDayShare: number;
};

export function deriveMetrics(raw: RawActivity, address: string, nowSec: number): Metrics {
  const me = address.toLowerCase();
  const counted = raw.recentTxs.filter((t) => t.isError === "0" && t.from.toLowerCase() === me);

  const perDay = new Map<number, number>();
  const contracts = new Set<string>();
  for (const t of counted) {
    const day = Math.floor(Number(t.timeStamp) / DAY_SEC);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const to = (t.to ?? "").toLowerCase();
    if (to && to !== me) contracts.add(to);
  }
  const top2 = [...perDay.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);

  const tokens = new Set<string>();
  const usdc = USDC_ADDRESS.toLowerCase();
  let usdcTransfers = 0;
  for (const t of raw.tokenTxs) {
    const c = t.contractAddress.toLowerCase();
    tokens.add(c);
    if (c === usdc) usdcTransfers++;
  }

  const first = raw.firstTx;
  const firstTs = first ? Number(first.timeStamp) : null;
  return {
    ageDays: firstTs === null ? 0 : Math.max(0, Math.floor((nowSec - firstTs) / DAY_SEC)),
    firstBlock: first ? Number(first.blockNumber) : null,
    firstTs,
    txCount: Math.min(MAX_TXS, counted.length),
    txCapped: counted.length >= MAX_TXS,
    activeDays: perDay.size,
    distinctContracts: contracts.size,
    distinctTokens: tokens.size,
    usdcTransfers,
    busiestDayShare: counted.length ? top2 / counted.length : 0,
  };
}
