import { describe, expect, it } from "vitest";
import { deriveMetrics, type ExplorerTx, type RawActivity } from "../../lib/prescore/metrics";
import { USDC_ADDRESS } from "../../lib/prescore/constants";

const ME = "0xAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const C1 = "0x1111111111111111111111111111111111111111";
const C2 = "0x2222222222222222222222222222222222222222";
const DAY1 = 1794300000; // some UTC day
const DAY2 = DAY1 + 86400;
const NOW = DAY2 + 3600;

function tx(p: Partial<ExplorerTx>): ExplorerTx {
  return { hash: "0x" + Math.random().toString(16).slice(2), from: ME, to: C1, timeStamp: String(DAY1), isError: "0", blockNumber: "100", ...p };
}
const empty: RawActivity = { firstTx: null, recentTxs: [], tokenTxs: [] };

describe("deriveMetrics", () => {
  it("counts only successful outbound txs", () => {
    const raw: RawActivity = {
      firstTx: tx({ timeStamp: String(DAY1), blockNumber: "252101" }),
      recentTxs: [
        tx({ to: C1, timeStamp: String(DAY1) }),
        tx({ to: C2, timeStamp: String(DAY1 + 10) }),
        tx({ to: C1, timeStamp: String(DAY2) }),
        tx({ isError: "1" }),
        tx({ from: C1, to: ME }),
      ],
      tokenTxs: [],
    };
    const m = deriveMetrics(raw, ME.toLowerCase(), NOW);
    expect(m.txCount).toBe(3);
    expect(m.activeDays).toBe(2);
    expect(m.distinctContracts).toBe(2);
    expect(m.firstBlock).toBe(252101);
    expect(m.firstTs).toBe(DAY1);
    expect(m.ageDays).toBe(Math.floor((NOW - DAY1) / 86400));
  });
  it("is case-insensitive on from, and excludes self and empty to", () => {
    const raw: RawActivity = {
      firstTx: null,
      recentTxs: [tx({ from: ME.toLowerCase() }), tx({ to: ME }), tx({ to: "" })],
      tokenTxs: [],
    };
    const m = deriveMetrics(raw, ME.toLowerCase(), NOW);
    expect(m.txCount).toBe(3);
    expect(m.distinctContracts).toBe(1);
  });
  it("caps at 1000", () => {
    const recentTxs = Array.from({ length: 1005 }, () => tx({}));
    const m = deriveMetrics({ ...empty, recentTxs }, ME, NOW);
    expect(m.txCount).toBe(1000);
    expect(m.windowFull).toBe(true);
    expect(deriveMetrics({ ...empty, recentTxs: recentTxs.slice(0, 5) }, ME, NOW).windowFull).toBe(false);
  });
  it("windowFull: a full 1,000-row txlist window, whoever sent the rows (999 / 1000 / 1001)", () => {
    const incoming = (n: number) => Array.from({ length: n }, (_, i) => tx({ from: C1, to: ME, timeStamp: String(DAY1 + i) }));
    const mine = (n: number) => Array.from({ length: n }, (_, i) => tx({ timeStamp: String(DAY1 + i) }));
    for (const [n, full] of [[999, false], [1000, true], [1001, true]] as const) {
      const m = deriveMetrics({ ...empty, recentTxs: [...mine(40), ...incoming(n - 40)] }, ME, NOW);
      expect(m.windowFull, String(n)).toBe(full);
      expect(m.txCount, String(n)).toBe(40); // only 40 sent, but older ones may exist: a lower bound
    }
    // Rows dropped while cleaning do not hide a full window.
    expect(deriveMetrics({ ...empty, recentTxs: mine(998), recentFetched: 1000 }, ME, NOW).windowFull).toBe(true);
  });
  it("tokenWindowFull: a full 1,000-row tokentx window (999 / 1000 / 1001)", () => {
    const t = (n: number) => Array.from({ length: n }, () => ({ contractAddress: C1, from: C2, to: ME, timeStamp: String(DAY1) }));
    for (const [n, full] of [[999, false], [1000, true], [1001, true]] as const) {
      const m = deriveMetrics({ ...empty, tokenTxs: t(n) }, ME, NOW);
      expect(m.tokenWindowFull, String(n)).toBe(full);
      expect(m.windowFull).toBe(false);
    }
    expect(deriveMetrics({ ...empty, tokenTxs: t(3), tokenFetched: 1000 }, ME, NOW).tokenWindowFull).toBe(true);
  });
  it("firstBlock is null unless the block number is plain digits", () => {
    for (const bad of ["", "0x1f", "12.5", "-3", "1e5", "abc", " 12"]) {
      const m = deriveMetrics({ ...empty, firstTx: tx({ blockNumber: bad }) }, ME, NOW);
      expect(m.firstBlock, bad).toBeNull();
      expect(m.firstTs).toBe(DAY1);
    }
    expect(deriveMetrics({ ...empty, firstTx: tx({ blockNumber: "252101" }) }, ME, NOW).firstBlock).toBe(252101);
  });
  it("no history gives zeros", () => {
    const m = deriveMetrics(empty, ME, NOW);
    expect(m).toEqual({
      ageDays: 0, firstBlock: null, firstTs: null, txCount: 0, windowFull: false, tokenWindowFull: false, activeDays: 0,
      distinctContracts: 0, distinctTokens: 0, usdcTransfers: 0, busiestDayShare: 0,
    });
  });
  it("counts distinct tokens and USDC transfers case-insensitively", () => {
    const t = (c: string) => ({ contractAddress: c, from: ME, to: C1, timeStamp: String(DAY1) });
    const raw: RawActivity = {
      ...empty,
      tokenTxs: [t(USDC_ADDRESS), t(USDC_ADDRESS.toLowerCase()), t(C1), t(C1.toUpperCase().replace("0X", "0x"))],
    };
    const m = deriveMetrics(raw, ME, NOW);
    expect(m.distinctTokens).toBe(2);
    expect(m.usdcTransfers).toBe(2);
  });
  it("busiestDayShare is share on the 2 busiest days", () => {
    const d = (n: number, k: number) => Array.from({ length: k }, () => tx({ timeStamp: String(DAY1 + n * 86400) }));
    const m = deriveMetrics({ ...empty, recentTxs: [...d(0, 5), ...d(1, 3), ...d(2, 1), ...d(3, 1)] }, ME, NOW + 9 * 86400);
    expect(m.busiestDayShare).toBeCloseTo(0.8);
    expect(m.activeDays).toBe(4);
  });
});
