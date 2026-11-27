import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { deriveQueue, isTreasury, LINE_OPEN_MAX, openAmount, type AgentLineState, type LineRequest } from "../lib/admin";
import {
  CAPS_TEXT,
  depositBlocker,
  depositRoom,
  MSG_PAUSED,
  parseUsdInput,
  withdrawShares,
  type PoolState,
  type WalletState,
} from "../lib/lend";
import { humanizeError } from "../lib/tx-errors";

const USD = 1_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const TREASURY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const pool = (o: Partial<PoolState> = {}): PoolState => ({
  usdc: ZERO,
  paused: false,
  maxPerWallet: 1_000n * USD,
  maxTotalDeposits: 10_000n * USD,
  totalAssets: 0n,
  idleLiquidity: 0n,
  ...o,
});
const wallet = (o: Partial<WalletState> = {}): WalletState => ({
  usdcBalance: 5_000n * USD,
  allowance: 0n,
  depositedOf: 0n,
  shares: 0n,
  lockedShares: 0n,
  freeShares: 0n,
  positionAssets: 0n,
  lockedAssets: 0n,
  freeAssets: 0n,
  ...o,
});

describe("lend copy", () => {
  it("caps line is exact", () => {
    expect(CAPS_TEXT).toBe("Max $1,000 per wallet · $10,000 total");
    expect(MSG_PAUSED).toBe("Deposits are paused");
  });

  it("caps line and RiskNote render above the deposit button", () => {
    const src = readFileSync(join(__dirname, "..", "components", "LendPanel.tsx"), "utf8");
    const risk = src.indexOf("<RiskNote />");
    const caps = src.indexOf("{CAPS_TEXT}");
    const submit = src.indexOf('type="submit"');
    expect(risk).toBeGreaterThan(0);
    expect(caps).toBeGreaterThan(risk);
    expect(submit).toBeGreaterThan(caps);
  });

  it("lend and admin sources avoid return promises", () => {
    for (const f of ["components/LendPanel.tsx", "components/AdminPanel.tsx", "app/(site)/lend/page.tsx", "app/(site)/admin/page.tsx", "lib/lend.ts", "lib/admin.ts"]) {
      const text = readFileSync(join(__dirname, "..", f), "utf8");
      for (const bad of [/\bTVL\b/, /in treasury/i, /\bAPY\b/, /\bAPR\b/, /\byield/i, /\bearn/i, /(?<!un)audited/i, /guarantee/i]) {
        expect(`${f}: ${bad}: ${bad.test(text)}`).toBe(`${f}: ${bad}: false`);
      }
    }
  });
});

describe("parseUsdInput", () => {
  it("parses dollars into 6-decimal units", () => {
    expect(parseUsdInput("25")).toBe(25n * USD);
    expect(parseUsdInput(" $1,000.5 ")).toBe(1_000_500_000n);
    expect(parseUsdInput("0.000001")).toBe(1n);
    expect(parseUsdInput(".5")).toBe(500_000n);
    expect(parseUsdInput("7.")).toBe(7n * USD);
  });
  it("rejects junk, negatives and over-precision", () => {
    for (const bad of ["", " ", "-1", "abc", "1e3", "1.0000001", "1.2.3", "$", "."]) expect(parseUsdInput(bad)).toBeNull();
  });
});

describe("deposit caps", () => {
  it("paused blocks before anything else", () => {
    expect(depositBlocker(10n * USD, pool({ paused: true }), wallet())).toBe("Deposits are paused");
    expect(depositBlocker(null, pool({ paused: true }), null)).toBe("Deposits are paused");
  });
  it("needs a positive amount", () => {
    expect(depositBlocker(null, pool(), wallet())).toMatch(/Enter an amount/);
    expect(depositBlocker(0n, pool(), wallet())).toMatch(/Enter an amount/);
  });
  it("checks wallet balance", () => {
    expect(depositBlocker(11n * USD, pool(), wallet({ usdcBalance: 10n * USD }))).toMatch(/Not enough USDC/);
  });
  it("per-wallet cap is inclusive at exactly $1,000", () => {
    expect(depositBlocker(400n * USD, pool(), wallet({ depositedOf: 600n * USD }))).toBeNull();
    expect(depositBlocker(400n * USD + 1n, pool(), wallet({ depositedOf: 600n * USD }))).toMatch(/per-wallet cap.*\$400\.00/);
  });
  it("total cap is inclusive at exactly $10,000", () => {
    expect(depositBlocker(500n * USD, pool({ totalAssets: 9_500n * USD }), wallet())).toBeNull();
    expect(depositBlocker(500n * USD + 1n, pool({ totalAssets: 9_500n * USD }), wallet())).toMatch(/total cap.*\$500\.00/);
  });
  it("uses the on-chain caps when tightened", () => {
    expect(depositBlocker(200n * USD, pool({ maxPerWallet: 100n * USD }), wallet())).toMatch(/per-wallet cap/);
  });
  it("room is the smaller cap, never negative", () => {
    expect(depositRoom(pool({ totalAssets: 9_900n * USD }), 0n)).toBe(100n * USD);
    expect(depositRoom(pool(), 700n * USD)).toBe(300n * USD);
    expect(depositRoom(pool({ totalAssets: 10_050n * USD }), 1_200n * USD)).toBe(0n);
  });
});

describe("withdrawShares", () => {
  it("clamps convertToShares(amount) to unlocked shares", () => {
    expect(withdrawShares(5n, 10n)).toBe(5n);
    expect(withdrawShares(50n, 10n)).toBe(10n);
    expect(withdrawShares(0n, 10n)).toBe(0n);
    expect(withdrawShares(5n, 0n)).toBe(0n);
  });
});

describe("lend errors", () => {
  it("maps pool caps and liquidity reverts", () => {
    const rev = (errorName: string) => ({ name: "ContractFunctionExecutionError", cause: { data: { errorName } } });
    expect(humanizeError(rev("CapExceeded"))).toMatch(/caps/);
    expect(humanizeError(rev("InsufficientLiquidity"))).toMatch(/idle USDC/);
    expect(humanizeError(rev("BadAmount"), { BadAmount: "x" })).toBe("x");
    expect(humanizeError(rev("BadAmount"))).toBe("That line amount is not allowed.");
  });
});

describe("admin queue", () => {
  it("opens min(request, $50)", () => {
    expect(openAmount(5n * USD)).toBe(5n * USD);
    expect(openAmount(50n * USD)).toBe(LINE_OPEN_MAX);
    expect(openAmount(80n * USD)).toBe(50n * USD);
  });

  it("gates on the treasury address, case-insensitive", () => {
    expect(isTreasury(TREASURY.toLowerCase(), TREASURY)).toBe(true);
    expect(isTreasury(OTHER, TREASURY)).toBe(false);
    expect(isTreasury(undefined, TREASURY)).toBe(false);
    expect(isTreasury(TREASURY, undefined)).toBe(false);
  });

  const req = (agentId: number, amount: bigint, block: number, owner: Address = OTHER): LineRequest => ({
    agentId: BigInt(agentId),
    owner,
    amount,
    block: BigInt(block),
  });
  const st = (agentId: number, o: Partial<AgentLineState> = {}): AgentLineState => ({
    agentId: BigInt(agentId),
    name: `Agent #${agentId}`,
    pending: 0n,
    backer: ZERO,
    lineAmount: 0n,
    defaulted: false,
    openLoanId: 0n,
    ...o,
  });

  it("lists only live requests (not opened, closed or defaulted), oldest first", () => {
    const requests = [req(1, 5n * USD, 10), req(2, 20n * USD, 11), req(3, 5n * USD, 12), req(4, 5n * USD, 13), req(5, 9n * USD, 9), req(5, 70n * USD, 20, TREASURY)];
    const states = [
      st(1, { pending: 5n * USD }),
      st(2, { backer: TREASURY, lineAmount: 20n * USD, openLoanId: 3n }), // opened
      st(3), // opened then closed: pending cleared
      st(4, { pending: 5n * USD, defaulted: true }),
      st(5, { pending: 70n * USD }), // re-requested: latest log wins
    ];
    const { pending, backed } = deriveQueue(requests, states, TREASURY.toLowerCase());
    expect(pending.map((p) => Number(p.agentId))).toEqual([1, 5]);
    expect(pending[1]).toMatchObject({ requested: 70n * USD, openAmount: 50n * USD, owner: TREASURY, requestedAtBlock: 20n });
    expect(backed).toEqual([{ agentId: 2n, name: "Agent #2", lineAmount: 20n * USD, openLoanId: 3n }]);
  });

  it("excludes lines backed by someone else", () => {
    const { pending, backed } = deriveQueue([req(1, 5n * USD, 1)], [st(1, { backer: OTHER, lineAmount: 5n * USD })], TREASURY);
    expect(pending).toEqual([]);
    expect(backed).toEqual([]);
  });
});
