import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  adminGate,
  clampOpen,
  createAdminScanner,
  deriveQueue,
  STEP_UP_AFTER,
  STEP_UP_LINE,
  emptyAdminFold,
  foldAdminLogs,
  isTreasury,
  lineOffers,
  MIN_LINE,
  MSG_TREASURY_WRONG_CHAIN,
  NEW_AGENT_LINE,
  readAdminState,
  treasuryRepaidLoans,
  type AgentLineState,
  type LineRequest,
} from "../lib/admin";
import type { Ev } from "../lib/logs";
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

describe("admin policy", () => {
  it("defaults to $5 and offers $25 only after 3 qualified treasury-backed repayments", () => {
    expect(lineOffers(50n * USD, 50n * USD, 0)).toEqual({ defaultAmount: 5n * USD, stepUpAmount: null, max: 50n * USD });
    expect(lineOffers(50n * USD, 50n * USD, 2).stepUpAmount).toBeNull();
    expect(lineOffers(50n * USD, 50n * USD, 3).stepUpAmount).toBe(25n * USD);
    expect(NEW_AGENT_LINE).toBe(5n * USD);
    expect(STEP_UP_LINE).toBe(25n * USD);
    expect(STEP_UP_AFTER).toBe(3);
  });

  it("clamps to [MIN_LOAN, min(request, maxLoan)]", () => {
    expect(clampOpen(1n, 20n * USD, 50n * USD)).toBe(MIN_LINE);
    expect(clampOpen(30n * USD, 20n * USD, 50n * USD)).toBe(20n * USD);
    expect(clampOpen(30n * USD, 50n * USD, 10n * USD)).toBe(10n * USD); // tightened maxLoan
    expect(clampOpen(7n * USD, 20n * USD, 50n * USD)).toBe(7n * USD);
    expect(clampOpen(5n * USD, 50n * USD, 4n * USD)).toBeNull(); // maxLoan below MIN_LOAN: nothing valid
    // $25 earned but the request is only $10: the offer is clamped to the request
    expect(lineOffers(10n * USD, 50n * USD, 5)).toEqual({ defaultAmount: 5n * USD, stepUpAmount: 10n * USD, max: 10n * USD });
  });

  it("gates on the treasury address, case-insensitive", () => {
    expect(isTreasury(TREASURY.toLowerCase(), TREASURY)).toBe(true);
    expect(isTreasury(OTHER, TREASURY)).toBe(false);
    expect(isTreasury(undefined, TREASURY)).toBe(false);
    expect(isTreasury(TREASURY, undefined)).toBe(false);
  });

  it("gives the treasury on the wrong chain its own state and message", () => {
    const base = { configured: true, connected: true, onElysium: true, address: TREASURY, treasury: TREASURY };
    expect(adminGate(base)).toBe("ok");
    expect(adminGate({ ...base, onElysium: false })).toBe("wrong-chain");
    expect(adminGate({ ...base, address: OTHER, onElysium: false })).toBe("not-treasury");
    expect(adminGate({ ...base, address: OTHER })).toBe("not-treasury");
    expect(adminGate({ ...base, connected: false })).toBe("connect");
    expect(adminGate({ ...base, configured: false })).toBe("not-configured");
    expect(MSG_TREASURY_WRONG_CHAIN).toMatch(/treasury wallet is connected, but on another network/);
    expect(MSG_TREASURY_WRONG_CHAIN).toMatch(/99901/);
  });
});

describe("admin queue", () => {
  const req = (agentId: number, amount: bigint, block: number, owner: Address = OTHER): LineRequest => ({
    agentId: BigInt(agentId),
    owner,
    amount,
    block: BigInt(block),
  });
  const st = (agentId: number, o: Partial<AgentLineState> = {}): AgentLineState => ({
    agentId: BigInt(agentId),
    name: `Agent #${agentId}`,
    owner: OTHER,
    pending: 0n,
    backer: ZERO,
    lineAmount: 0n,
    defaulted: false,
    openLoanId: 0n,
    score: 0n,
    repaidCount: 0n,
    qualifiedRepaid: 0n,
    pastBackers: [],
    treasuryQualified: 0,
    ...o,
  });

  it("lists only live requests (not opened, closed or defaulted), oldest first, with policy amounts", () => {
    const requests = [req(1, 5n * USD, 10), req(2, 20n * USD, 11), req(3, 5n * USD, 12), req(4, 5n * USD, 13), req(5, 9n * USD, 9), req(5, 50n * USD, 20)];
    const states = [
      st(1, { pending: 5n * USD }),
      st(2, { backer: TREASURY, lineAmount: 20n * USD, openLoanId: 3n }), // opened
      st(3), // opened then closed: pending cleared
      st(4, { pending: 5n * USD, defaulted: true }),
      st(5, { pending: 50n * USD, owner: TREASURY, score: 612n, repaidCount: 4n, qualifiedRepaid: 3n, treasuryQualified: 3, pastBackers: [OTHER, TREASURY] }),
    ];
    const { pending, backed } = deriveQueue(requests, states, TREASURY.toLowerCase(), 50n * USD);
    expect(pending.map((p) => Number(p.agentId))).toEqual([1, 5]);
    expect(pending[0]).toMatchObject({ defaultAmount: 5n * USD, stepUpAmount: null });
    expect(pending[1]).toMatchObject({
      requested: 50n * USD,
      defaultAmount: 5n * USD,
      stepUpAmount: 25n * USD,
      maxAmount: 50n * USD,
      owner: TREASURY, // current NFT owner from the state, not the LineRequested log
      requestedAtBlock: 20n,
      score: 612n,
      repaidCount: 4n,
      qualifiedRepaid: 3n,
      pastBackers: [OTHER, TREASURY],
    });
    expect(backed).toEqual([{ agentId: 2n, name: "Agent #2", lineAmount: 20n * USD, openLoanId: 3n }]);
  });

  it("excludes lines backed by someone else", () => {
    const { pending, backed } = deriveQueue([req(1, 5n * USD, 1)], [st(1, { backer: OTHER, lineAmount: 5n * USD })], TREASURY, 50n * USD);
    expect(pending).toEqual([]);
    expect(backed).toEqual([]);
  });
});

describe("admin log fold", () => {
  let n = 0;
  const ev = (eventName: string, args: Record<string, unknown>, block?: number): Ev => ({
    eventName,
    blockNumber: BigInt(block ?? ++n),
    logIndex: 0,
    args,
  });

  it("counts only repayments on loans taken while the treasury backed the line", () => {
    const f = emptyAdminFold();
    foldAdminLogs(f, [
      ev("LineRequested", { agentId: 1n, owner: OTHER, amount: 5n * USD }),
      ev("LineOpened", { agentId: 1n, backer: OTHER, amount: 5n * USD, lockedShares: 1n }),
      ev("Borrowed", { loanId: 1n, agentId: 1n, borrower: OTHER, amount: 5n * USD, fee: 1n, dueAt: 1n }),
      ev("Repaid", { loanId: 1n, agentId: 1n, payer: OTHER, amount: 5n * USD, fee: 1n }),
      ev("LineClosed", { agentId: 1n }),
      ev("LineRequested", { agentId: 1n, owner: OTHER, amount: 25n * USD }),
      ev("LineOpened", { agentId: 1n, backer: TREASURY, amount: 5n * USD, lockedShares: 1n }),
      ev("Borrowed", { loanId: 2n, agentId: 1n, borrower: OTHER, amount: 5n * USD, fee: 1n, dueAt: 1n }),
      ev("Repaid", { loanId: 2n, agentId: 1n, payer: OTHER, amount: 5n * USD, fee: 1n }),
      ev("Borrowed", { loanId: 3n, agentId: 1n, borrower: OTHER, amount: 5n * USD, fee: 1n, dueAt: 1n }),
    ]);
    expect(treasuryRepaidLoans(f, "1", TREASURY.toLowerCase()).map((r) => r.loanId)).toEqual([2n]);
    expect(f.pastBackers.get("1")).toEqual([OTHER, TREASURY]);
    expect(f.lineBacker.get("1")).toBe(TREASURY);
    expect(f.requestOpen.has("1")).toBe(false);
  });

  it("folds out-of-order input by chain position", () => {
    const f = emptyAdminFold();
    foldAdminLogs(f, [
      ev("Borrowed", { loanId: 9n, agentId: 4n, borrower: OTHER, amount: 5n * USD, fee: 1n, dueAt: 1n }, 1001),
      ev("LineOpened", { agentId: 4n, backer: TREASURY, amount: 5n * USD, lockedShares: 1n }, 1000),
    ]);
    expect(f.loanBacker.get("9")?.backer).toBe(TREASURY);
  });
});

/** Mock client for readAdminState: getLogs honours block ranges, reads are plain eth_calls. */
function adminClient(logs: (Ev & { address?: string })[], o: { head?: bigint; paused?: boolean; maxLoan?: bigint; loanStart?: Record<string, bigint>; blockTime?: Record<string, bigint> } = {}) {
  const calls = { getLogs: [] as { fromBlock: bigint; toBlock: bigint }[], getLoan: 0, getBlock: 0 };
  const head = { value: o.head ?? 1_000n };
  const client = {
    getBlockNumber: async () => head.value,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.getLogs.push({ fromBlock, toBlock });
      return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      calls.getBlock++;
      return { timestamp: o.blockTime?.[blockNumber.toString()] ?? 0n };
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      const id = args?.[0];
      switch (functionName) {
        case "pendingRequest":
          return id === 7n ? 50n * USD : 0n;
        case "lines":
          return id === 8n ? [TREASURY, 5n * USD, 1n] : [ZERO, 0n, 0n];
        case "creditReport":
          return [700n, 4n, 3n, 0n, 0n, ZERO, 0n, false, 0n];
        case "tokenURI":
          return "x".repeat(9_000); // oversized: no metadata
        case "ownerOf":
          return TREASURY; // current owner differs from the request log's owner (OTHER)
        case "getLoan":
          calls.getLoan++;
          return { start: o.loanStart?.[String(id)] ?? 0n };
        case "paused":
          return o.paused ?? false;
        case "maxLoan":
          return o.maxLoan ?? 50n * USD;
        case "treasury":
          return TREASURY;
        case "sharesOf":
        case "lockedSharesOf":
        case "sponsorFees":
        case "convertToAssets":
          return 0n;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  } as unknown as PublicClient;
  return { client, calls, head };
}

describe("readAdminState", () => {
  const cfg = { identity: OTHER, pool: OTHER, fromBlock: 1n };
  const DAY = 86_400n;
  const L = (eventName: string, args: Record<string, unknown>, block: number): Ev => ({ eventName, blockNumber: BigInt(block), logIndex: 0, args });
  const history = () => [
    L("LineRequested", { agentId: 7n, owner: OTHER, amount: 5n * USD }, 10),
    L("LineOpened", { agentId: 7n, backer: TREASURY, amount: 5n * USD, lockedShares: 1n }, 11),
    ...[1, 2, 3].flatMap((i) => [
      L("Borrowed", { loanId: BigInt(i), agentId: 7n, borrower: OTHER, amount: 5n * USD, fee: 1n, dueAt: 1n }, 20 * i),
      L("Repaid", { loanId: BigInt(i), agentId: 7n, payer: OTHER, amount: 5n * USD, fee: 1n }, 20 * i + 1),
    ]),
    L("LineClosed", { agentId: 7n }, 90),
    L("LineRequested", { agentId: 7n, owner: OTHER, amount: 50n * USD }, 95),
  ];
  const times = { loanStart: { "1": 0n, "2": 0n, "3": 0n }, blockTime: { "21": 3n * DAY, "41": 3n * DAY, "61": 3n * DAY - 1n } };

  it("offers $25 only after 3 qualified treasury-backed repayments and shows the current owner", async () => {
    const m = adminClient(history(), times);
    const s = await readAdminState(m.client, cfg, TREASURY, createAdminScanner());
    expect(s.pending).toHaveLength(1);
    // loan 3 was held 1 s short of 3 days: only 2 qualify
    expect(s.pending[0]).toMatchObject({ agentId: 7n, treasuryQualified: 2, stepUpAmount: null, defaultAmount: 5n * USD, owner: TREASURY, name: "Agent #7", score: 700n });
    expect(s.pending[0].pastBackers).toEqual([TREASURY]);

    const m2 = adminClient(history(), { ...times, blockTime: { ...times.blockTime, "61": 4n * DAY } });
    const s2 = await readAdminState(m2.client, cfg, TREASURY, createAdminScanner());
    expect(s2.pending[0]).toMatchObject({ treasuryQualified: 3, stepUpAmount: 25n * USD });
  });

  it("reads paused and maxLoan, and flags a treasury mismatch", async () => {
    const m = adminClient(history(), { ...times, paused: true, maxLoan: 20n * USD });
    const s = await readAdminState(m.client, cfg, TREASURY, createAdminScanner());
    expect(s.paused).toBe(true);
    expect(s.maxLoan).toBe(20n * USD);
    expect(s.pending[0].maxAmount).toBe(20n * USD);
    expect(s.treasuryMismatch).toBe(false);
    const s2 = await readAdminState(m.client, cfg, OTHER, createAdminScanner());
    expect(s2.treasuryMismatch).toBe(true);
  });

  it("scans incrementally and caches per-loan qualification", async () => {
    const logs = history();
    const m = adminClient(logs, times);
    const sc = createAdminScanner();
    await readAdminState(m.client, cfg, TREASURY, sc);
    expect(m.calls.getLogs.every((g) => g.fromBlock === 1n && g.toBlock === 995n)).toBe(true);
    const loanReads = m.calls.getLoan;
    m.calls.getLogs = [];
    m.head.value = 2_000n;
    logs.push(L("LineOpened", { agentId: 8n, backer: TREASURY, amount: 5n * USD, lockedShares: 1n }, 1_500));
    const s = await readAdminState(m.client, cfg, TREASURY, sc);
    expect(m.calls.getLogs.every((g) => g.fromBlock === 996n && g.toBlock === 1_995n)).toBe(true);
    expect(m.calls.getLoan).toBe(loanReads); // repaid loans are never re-read
    expect(s.backed.map((b) => b.agentId)).toEqual([8n]);
  });

  it("refuses to scan without a deploy block", async () => {
    const m = adminClient([]);
    await expect(readAdminState(m.client, { ...cfg, fromBlock: 0n }, TREASURY, createAdminScanner())).rejects.toThrow(/not configured/);
  });
});
