import { describe, expect, it } from "vitest";
import { createPublicClient, custom, type PublicClient } from "viem";
import { createIndexer, MAX_URI_BYTES, publicAgent, SAFE_LAG } from "../lib/indexer";
import { CHUNK, CONCURRENCY } from "../lib/logs";
import { DATA_URI_PREFIX } from "../lib/agent-uri";
import { elysium } from "../lib/chain";

const IDENTITY = "0x00000000000000000000000000000000000000a1";
const POOL = "0x00000000000000000000000000000000000000b2";
const OWNER = "0x00000000000000000000000000000000000000c3";
const OWNER2 = "0x00000000000000000000000000000000000000d4";
const HOUSE = "0x00000000000000000000000000000000000000e5";
const TREASURY = "0x00000000000000000000000000000000000000f6";
const ZERO = "0x0000000000000000000000000000000000000000";
const cfg = { identity: IDENTITY, pool: POOL, deployBlock: 1n, houseOwner: undefined } as const;

type Log = {
  address: string; eventName: string; blockNumber: bigint; logIndex: number; transactionHash?: string; args: Record<string, unknown>;
};

let seq = 0;
const idLog = (eventName: string, args: Record<string, unknown>): Log => ({
  address: IDENTITY, eventName, blockNumber: BigInt(++seq), logIndex: 0, args,
});
const poolLog = (eventName: string, args: Record<string, unknown>): Log => ({
  address: POOL, eventName, blockNumber: BigInt(++seq), logIndex: 0, args,
});
const at = (l: Log, block: bigint): Log => ({ ...l, blockNumber: block });
const reg = (id: bigint, owner = OWNER, uri = `ipfs://${id}`) => idLog("Registered", { agentId: id, agentURI: uri, owner });
const requested = (id: bigint) => poolLog("LineRequested", { agentId: id, owner: OWNER, amount: 5n });
const opened = (id: bigint) => poolLog("LineOpened", { agentId: id, backer: OWNER, amount: 5n, lockedShares: 5n });
const closed = (id: bigint) => poolLog("LineClosed", { agentId: id });
const dataUri = (o: unknown) => `${DATA_URI_PREFIX}${btoa(JSON.stringify(o))}`;

// creditReport tuple: score, repaidCount, qualifiedRepaid, dollarDays, lineAmount, backer, firstRepaidAt, defaulted, openLoanId
type Report = readonly [bigint, bigint, bigint, bigint, bigint, string, bigint, boolean, bigint];
const report = (
  o: { score?: bigint; repaid?: bigint; qualified?: bigint; line?: bigint; backer?: string; defaulted?: boolean } = {},
): Report => [o.score ?? 0n, o.repaid ?? 0n, o.qualified ?? 0n, 0n, o.line ?? 0n, o.backer ?? ZERO, 0n, o.defaulted ?? false, 0n];

interface Mock {
  client: PublicClient;
  logs: Log[];
  calls: { getBlockNumber: number; getLogs: { address: string; fromBlock: bigint; toBlock: bigint }[]; reads: string[] };
  head: { value: bigint };
  fail: { logs: boolean; reads: boolean; pledge: boolean };
  pledge: { deposited: bigint; outstanding: bigint };
}

/** Mock client honouring getLogs block ranges. No multicall: the indexer must use plain (batched) reads. */
function mockClient(logs: Log[], reports: Record<string, Report> = {}, head = 1_000n): Mock {
  const m: Mock = {
    logs,
    calls: { getBlockNumber: 0, getLogs: [], reads: [] },
    head: { value: head },
    fail: { logs: false, reads: false, pledge: false },
    pledge: { deposited: 0n, outstanding: 0n },
    client: undefined as unknown as PublicClient,
  };
  const get = (id: bigint) => reports[id.toString()] ?? report();
  m.client = {
    getBlockNumber: async () => {
      m.calls.getBlockNumber++;
      if (m.fail.logs) throw new Error("rpc down");
      return m.head.value;
    },
    getLogs: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      m.calls.getLogs.push({ address, fromBlock, toBlock });
      if (m.fail.logs) throw new Error("rpc down");
      return m.logs.filter((l) => l.address === address && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      m.calls.reads.push(functionName);
      if (functionName === "creditReport") {
        if (m.fail.reads) throw new Error("rpc down");
        return get(args![0] as bigint);
      }
      if (m.fail.pledge) throw new Error("rpc down");
      if (functionName === "treasury") return TREASURY;
      if (functionName === "depositedOf") {
        expect(args![0]).toBe(TREASURY);
        return m.pledge.deposited;
      }
      if (functionName === "outstandingPrincipal") return m.pledge.outstanding;
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
  return m;
}

/** A controllable clock for TTL tests. */
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

async function statusOf(logs: Log[], reports: Record<string, Report> = {}) {
  const res = await createIndexer(cfg, mockClient(logs, reports).client).getAgents();
  expect(res.ok).toBe(true);
  return Object.fromEntries(res.items.map((a) => [a.id, a.status]));
}

describe("indexer", () => {
  it("returns empty state on rpc error", async () => {
    const client = createPublicClient({
      chain: elysium,
      transport: custom({
        async request() {
          throw new Error("rpc down");
        },
      }),
    });
    const ix = createIndexer(cfg, client as PublicClient);
    const stats = await ix.getStats();
    expect(stats.ok).toBe(false);
    expect(stats.pledgeOk).toBe(false);
    expect(stats.agents).toBe(0);
    expect(await ix.getAgents()).toMatchObject({ ok: false, items: [], stale: false, updatedAt: null });
  });

  it("returns empty state when addresses are unset", async () => {
    const ix = createIndexer({ identity: undefined, pool: undefined, deployBlock: 0n }, {} as PublicClient);
    const stats = await ix.getStats();
    expect(stats.ok).toBe(false);
    expect(stats.error).toBe("not configured");
  });

  it("refuses to index when the deploy block is unset (0) and never touches the RPC", async () => {
    const m = mockClient([reg(1n)]);
    const ix = createIndexer({ ...cfg, deployBlock: 0n }, m.client);
    expect(await ix.getAgents()).toMatchObject({ ok: false, error: "not configured", items: [] });
    expect(m.calls.getBlockNumber).toBe(0);
    expect(m.calls.getLogs).toEqual([]);
  });

  it("status derives correctly and credit report fields are parsed", async () => {
    const logs = [reg(1n), reg(2n), reg(3n), requested(2n), requested(3n), opened(3n)];
    const m = mockClient(logs, { "3": report({ score: 612n, repaid: 4n, qualified: 3n, line: 5n, backer: OWNER2 }) });
    const res = await createIndexer(cfg, m.client).getAgents();
    expect(res.ok).toBe(true);
    expect(res.stale).toBe(false);
    expect(Object.fromEntries(res.items.map((a) => [a.id, a.status]))).toEqual({ 1: "registered", 2: "requested", 3: "active" });
    const a3 = res.items.find((a) => a.id === 3)!;
    expect(a3).toMatchObject({ score: 612, repaidCount: 4, qualifiedRepaid: 3, lineAmount: 5n, defaulted: false, backer: OWNER2, selfBacked: false });
    expect(res.items.find((a) => a.id === 1)!.backer).toBeNull();
    // creditReport is read with plain (transport-batched) eth_calls; the mock has no multicall.
    expect(m.calls.reads.filter((r) => r === "creditReport")).toHaveLength(3);
  });

  it("selfBacked is true only when the line's backer is the agent's current owner", async () => {
    const logs = [reg(1n, OWNER), reg(2n, OWNER), opened(1n), opened(2n), idLog("Transfer", { from: OWNER, to: OWNER2, tokenId: 2n })];
    const res = await createIndexer(cfg, mockClient(logs, {
      "1": report({ line: 5n, backer: OWNER.toUpperCase().replace("0X", "0x") }),
      "2": report({ line: 5n, backer: OWNER }),
    }).client).getAgents();
    expect(res.items.map((a) => [a.id, a.selfBacked])).toEqual([[1, true], [2, false]]);
  });

  it("Defaulted event gives defaulted status and counts defaults", async () => {
    const logs = [reg(1n), opened(1n), poolLog("Defaulted", { loanId: 1n, agentId: 1n, burnedShares: 1n })];
    const ix = createIndexer(cfg, mockClient(logs).client);
    expect((await ix.getAgents()).items[0].status).toBe("defaulted");
    expect((await ix.getStats()).defaults).toBe(1);
  });

  it("creditReport defaulted=true gives defaulted status", async () => {
    expect(await statusOf([reg(1n), opened(1n)], { "1": report({ defaulted: true, line: 5n }) })).toEqual({ 1: "defaulted" });
  });

  it("LineRequested after LineClosed gives requested", async () => {
    expect(await statusOf([reg(1n), requested(1n), opened(1n), closed(1n), requested(1n)])).toEqual({ 1: "requested" });
  });

  it("LineRequested while a line is open stays active", async () => {
    expect(await statusOf([reg(1n), requested(1n), opened(1n), requested(1n)])).toEqual({ 1: "active" });
  });

  it("Transfer after Registered updates owner and the owner lookup follows", async () => {
    const logs = [reg(1n, OWNER), idLog("Transfer", { from: OWNER, to: OWNER2, tokenId: 1n })];
    const ix = createIndexer(cfg, mockClient(logs).client);
    expect((await ix.getAgent(1)).item?.owner).toBe(OWNER2);
    expect((await ix.getAgentsByOwner(OWNER2)).items.map((a) => a.id)).toEqual([1]);
    expect((await ix.getAgentsByOwner(OWNER)).items).toEqual([]);
  });

  it("isHouse needs the house wallet as original registrant AND current owner", async () => {
    const logs = [
      reg(1n, HOUSE), // registered and still held by the house wallet
      reg(2n, OWNER), idLog("Transfer", { from: OWNER, to: HOUSE, tokenId: 2n }), // spoof: sent to the house wallet
      reg(3n, HOUSE), idLog("Transfer", { from: HOUSE, to: OWNER, tokenId: 3n }), // house agent sold away
    ];
    const res = await createIndexer({ ...cfg, houseOwner: HOUSE }, mockClient(logs).client).getAgents();
    expect(res.items.map((a) => [a.id, a.isHouse])).toEqual([[1, true], [2, false], [3, false]]);
  });

  it("parses the name, drops agentURIs over 8 KB and never exposes the raw URI", async () => {
    const big = dataUri({ name: "Huge", description: "x".repeat(MAX_URI_BYTES) });
    expect(big.length).toBeGreaterThan(MAX_URI_BYTES);
    const logs = [
      reg(1n, OWNER, dataUri({ name: "Atlas", description: "Routes", endpoint: "https://atlas.example" })),
      reg(2n, OWNER, big),
      reg(3n, OWNER, dataUri({ name: "Old" })),
      idLog("AgentURISet", { agentId: 3n, agentURI: big }),
    ];
    const res = await createIndexer(cfg, mockClient(logs).client).getAgents();
    expect(res.items.map((a) => a.name)).toEqual(["Atlas", "Agent #2", "Agent #3"]);
    expect(res.items[0]).toMatchObject({ description: "Routes", endpoint: "https://atlas.example" });
    for (const a of res.items) expect("uri" in a).toBe(false);
    const pub = publicAgent(res.items[0]);
    expect(pub.name).toBe("Atlas");
    expect(Object.keys(pub)).not.toContain("uri");
    expect(Object.keys(pub)).not.toContain("description");
  });

  it("getAgentLoans groups Borrowed/Repaid/Defaulted per loan with tx hashes, newest first", async () => {
    const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
    const withTx = (l: Log, n: number): Log => ({ ...l, transactionHash: tx(n) });
    const logs = [
      reg(1n), reg(2n), opened(1n), opened(2n),
      withTx(poolLog("Borrowed", { loanId: 1n, agentId: 1n, borrower: OWNER, amount: 5_000_000n, fee: 1667n, dueAt: 86_400n }), 1),
      withTx(poolLog("Borrowed", { loanId: 2n, agentId: 2n, borrower: OWNER, amount: 9_000_000n, fee: 3000n, dueAt: 90_000n }), 2),
      withTx(poolLog("Repaid", { loanId: 1n, agentId: 1n, payer: OWNER2, amount: 5_000_000n, fee: 1667n }), 3),
      withTx(poolLog("Borrowed", { loanId: 3n, agentId: 1n, borrower: OWNER, amount: 7_000_000n, fee: 2000n, dueAt: 200_000n }), 4),
      withTx(poolLog("Defaulted", { loanId: 2n, agentId: 2n, burnedShares: 1n }), 5),
    ];
    const ix = createIndexer(cfg, mockClient(logs).client);
    const a1 = await ix.getAgentLoans(1);
    expect(a1.ok).toBe(true);
    expect(a1.items.map((l) => [l.loanId, l.status])).toEqual([[3, "open"], [1, "repaid"]]);
    expect(a1.items[1]).toMatchObject({ agentId: 1, principal: 5_000_000n, fee: 1667n, dueAt: 86_400, borrowTx: tx(1), closeTx: tx(3) });
    expect(a1.items[0].closeTx).toBeNull();
    const a2 = await ix.getAgentLoans(2);
    expect(a2.items).toHaveLength(1);
    expect(a2.items[0]).toMatchObject({ loanId: 2, status: "defaulted", principal: 9_000_000n, borrowTx: tx(2), closeTx: tx(5) });
    expect((await ix.getAgentLoans(99)).items).toEqual([]);
  });

  it("getAgentLoans returns ok:false when the chain is unreadable", async () => {
    const ix = createIndexer({ identity: undefined, pool: undefined, deployBlock: 0n }, {} as PublicClient);
    expect(await ix.getAgentLoans(1)).toMatchObject({ ok: false, items: [] });
  });
});

describe("indexer incremental scan", () => {
  it("scans from the deploy block to head - SAFE_LAG, then only the new range", async () => {
    const c = clock();
    const m = mockClient([at(reg(1n), 10n)], {}, 100n);
    const ix = createIndexer({ ...cfg, deployBlock: 5n }, m.client, { now: c.now });
    expect((await ix.getAgents()).items.map((a) => a.id)).toEqual([1]);
    expect(m.calls.getLogs.map((g) => [g.fromBlock, g.toBlock])).toEqual([[5n, 100n - SAFE_LAG], [5n, 100n - SAFE_LAG]]);

    // New blocks with a new agent; logs in already-scanned blocks are never fetched again.
    m.calls.getLogs = [];
    m.head.value = 200n;
    m.logs.push(at(reg(2n), 150n));
    c.t += 15_000;
    const res = await ix.getAgents();
    expect(res.items.map((a) => a.id)).toEqual([1, 2]);
    expect(m.calls.getLogs.every((g) => g.fromBlock === 101n - SAFE_LAG && g.toBlock === 200n - SAFE_LAG)).toBe(true);
    expect(m.calls.getLogs).toHaveLength(2);
  });

  it("serves the cache within the TTL without touching the RPC", async () => {
    const c = clock();
    const m = mockClient([reg(1n)]);
    const ix = createIndexer(cfg, m.client, { now: c.now });
    await ix.getAgents();
    const before = m.calls.getBlockNumber;
    c.t += 14_999;
    await ix.getAgents();
    await ix.getAgent(1);
    expect(m.calls.getBlockNumber).toBe(before);
  });

  it("concurrent callers share one in-flight refresh", async () => {
    const m = mockClient([reg(1n), opened(1n)]);
    const ix = createIndexer(cfg, m.client);
    const [a, b, c2, d] = await Promise.all([ix.getAgents(), ix.getAgent(1), ix.getAgentLoans(1), ix.getStats()]);
    expect(m.calls.getBlockNumber).toBe(1);
    expect(a.ok && b.ok && c2.ok && d.ok).toBe(true);
    expect(m.calls.reads.filter((r) => r === "creditReport")).toHaveLength(1);
  });

  it("serves the last good snapshot as stale when a refresh fails, then recovers", async () => {
    const c = clock();
    const m = mockClient([reg(1n)]);
    const ix = createIndexer(cfg, m.client, { now: c.now });
    const first = await ix.getAgents();
    expect(first).toMatchObject({ ok: true, stale: false, updatedAt: c.t });

    m.fail.logs = true;
    c.t += 20_000;
    const stale = await ix.getAgents();
    expect(stale).toMatchObject({ ok: true, stale: true, updatedAt: first.updatedAt });
    expect(stale.items.map((a) => a.id)).toEqual([1]);
    const stats = await ix.getStats();
    expect(stats).toMatchObject({ ok: true, stale: true, agents: 1 });

    // A failed refresh is not retried on every request, only after the TTL.
    const calls = m.calls.getBlockNumber;
    c.t += 1_000;
    await ix.getAgents();
    expect(m.calls.getBlockNumber).toBe(calls);

    m.fail.logs = false;
    c.t += 15_000;
    expect(await ix.getAgents()).toMatchObject({ ok: true, stale: false, updatedAt: c.t });
  });

  it("a failed creditReport read keeps the old snapshot (stale) and the folded logs", async () => {
    const c = clock();
    const m = mockClient([reg(1n)]);
    const ix = createIndexer(cfg, m.client, { now: c.now });
    await ix.getAgents();
    m.head.value = 2_000n;
    m.logs.push(at(reg(2n), 1_500n));
    m.fail.reads = true;
    c.t += 15_000;
    expect(await ix.getAgents()).toMatchObject({ ok: true, stale: true });
    m.fail.reads = false;
    c.t += 15_000;
    expect((await ix.getAgents()).items.map((a) => a.id)).toEqual([1, 2]);
  });

  it("a cold start over a long chain keeps its progress across calls (syncing until caught up)", async () => {
    const c = clock();
    const window = CHUNK * BigInt(CONCURRENCY);
    const head = 1n + window * 3n + SAFE_LAG;
    const m = mockClient([at(reg(1n), 2n), at(reg(2n), head - SAFE_LAG)], {}, head);
    // budget 0: one window per call
    const ix = createIndexer(cfg, m.client, { now: c.now, budgetMs: 0 });
    const r1 = await ix.getAgents();
    expect(r1).toMatchObject({ ok: false, error: "syncing", items: [] });
    c.t += 15_000;
    await ix.getAgents();
    c.t += 15_000;
    await ix.getAgents();
    c.t += 15_000;
    const done = await ix.getAgents();
    expect(done.ok).toBe(true);
    expect(done.items.map((a) => a.id)).toEqual([1, 2]);
    // every block range was fetched exactly once per contract
    const pool = m.calls.getLogs.filter((g) => g.address === POOL);
    expect(pool[0].fromBlock).toBe(1n);
    for (let i = 1; i < pool.length; i++) expect(pool[i].fromBlock).toBe(pool[i - 1].toBlock + 1n);
    expect(pool[pool.length - 1].toBlock).toBe(head - SAFE_LAG);
  });
});

describe("indexer pledge read", () => {
  it("reads depositedOf(pool.treasury()) and outstandingPrincipal", async () => {
    const m = mockClient([reg(1n)]);
    m.pledge = { deposited: 1_000_000_000n, outstanding: 5_000_000n };
    const ix = createIndexer(cfg, m.client);
    const s = await ix.getStats();
    expect(s).toMatchObject({ ok: true, pledgeOk: true, treasuryDeposited: 1_000_000_000n, outstanding: 5_000_000n });
    expect(await ix.getPledge()).toMatchObject({ ok: true, deposited: 1_000_000_000n });
    expect(m.calls.reads).not.toContain("treasuryDeposited");
  });

  it("survives a failing log scan", async () => {
    const m = mockClient([reg(1n)]);
    m.pledge.deposited = 250_000_000n;
    m.fail.logs = true;
    const ix = createIndexer(cfg, m.client);
    const s = await ix.getStats();
    expect(s.ok).toBe(false);
    expect(s.pledgeOk).toBe(true);
    expect(s.treasuryDeposited).toBe(250_000_000n);
    expect(await ix.getPledge()).toMatchObject({ ok: true, stale: false, deposited: 250_000_000n });
  });

  it("serves the last pledge as stale when the read fails, and reads the treasury address once", async () => {
    const c = clock();
    const m = mockClient([]);
    m.pledge.deposited = 7n;
    const ix = createIndexer(cfg, m.client, { now: c.now });
    expect((await ix.getPledge()).deposited).toBe(7n);
    m.fail.pledge = true;
    c.t += 15_000;
    expect(await ix.getPledge()).toMatchObject({ ok: true, stale: true, deposited: 7n });
    m.fail.pledge = false;
    m.pledge.deposited = 9n;
    c.t += 15_000;
    expect(await ix.getPledge()).toMatchObject({ ok: true, stale: false, deposited: 9n });
    expect(m.calls.reads.filter((r) => r === "treasury")).toHaveLength(1);
  });

  it("is not configured without a pool address", async () => {
    const ix = createIndexer({ deployBlock: 1n }, {} as PublicClient);
    expect(await ix.getPledge()).toMatchObject({ ok: false, error: "not configured", deposited: 0n });
  });
});
