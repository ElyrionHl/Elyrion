import { DAY_SEC, MAX_TXS, USDC_ADDRESS } from "./constants";

export type ExplorerTx = { hash: string; from: string; to: string; timeStamp: string; isError: string; blockNumber: string };
export type ExplorerTokenTx = { contractAddress: string; from: string; to: string; timeStamp: string };
/**
 * `recentFetched` / `tokenFetched`: rows the explorer returned before cleaning (defaults to the list length).
 * They decide whether a fetch window was full, so a malformed row cannot hide a full window.
 */
export type RawActivity = {
  firstTx: ExplorerTx | null;
  recentTxs: ExplorerTx[];
  tokenTxs: ExplorerTokenTx[];
  recentFetched?: number;
  tokenFetched?: number;
};
export type Metrics = {
  ageDays: number;
  firstBlock: number | null;
  firstTs: number | null;
  txCount: number;
  /**
   * The txlist window was full (1,000 rows read): txCount, activeDays, distinctContracts and busiestDayShare cover
   * only the latest 1,000 transactions, so they are lower bounds, shown as "N+".
   */
  windowFull: boolean;
  /** The tokentx window was full: distinctTokens and usdcTransfers are lower bounds. */
  tokenWindowFull: boolean;
  activeDays: number;
  /** Distinct `to` addresses of counted txs (wallets included): "destinations", not only contracts. */
  distinctContracts: number;
  distinctTokens: number;
  usdcTransfers: number;
  /** Share (0..1) of counted txs that fall on the 2 busiest UTC days. */
  busiestDayShare: number;
};

const DIGITS = /^\d+$/;

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
  const firstBlock = first && DIGITS.test(first.blockNumber) ? Number(first.blockNumber) : null;
  return {
    ageDays: firstTs === null ? 0 : Math.max(0, Math.floor((nowSec - firstTs) / DAY_SEC)),
    firstBlock: firstBlock !== null && Number.isSafeInteger(firstBlock) ? firstBlock : null,
    firstTs,
    txCount: Math.min(MAX_TXS, counted.length),
    windowFull: Math.max(raw.recentFetched ?? 0, raw.recentTxs.length) >= MAX_TXS,
    tokenWindowFull: Math.max(raw.tokenFetched ?? 0, raw.tokenTxs.length) >= MAX_TXS,
    activeDays: perDay.size,
    distinctContracts: contracts.size,
    distinctTokens: tokens.size,
    usdcTransfers,
    busiestDayShare: counted.length ? top2 / counted.length : 0,
  };
}
