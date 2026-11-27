import { describe, expect, it } from "vitest";
import { createPublicClient, custom, type PublicClient } from "viem";
import { createIndexer } from "../lib/indexer";
import { elysium } from "../lib/chain";

const IDENTITY = "0x00000000000000000000000000000000000000a1";
const POOL = "0x00000000000000000000000000000000000000b2";
const OWNER = "0x00000000000000000000000000000000000000c3";
const OWNER2 = "0x00000000000000000000000000000000000000d4";
const cfg = { identity: IDENTITY, pool: POOL, deployBlock: 0n, houseOwner: undefined } as const;

type Log = { address: string; eventName: string; blockNumber: bigint; logIndex: number; args: Record<string, unknown> };

let seq = 0;
const idLog = (eventName: string, args: Record<string, unknown>): Log => ({
  address: IDENTITY, eventName, blockNumber: BigInt(++seq), logIndex: 0, args,
});
const poolLog = (eventName: string, args: Record<string, unknown>): Log => ({
  address: POOL, eventName, blockNumber: BigInt(++seq), logIndex: 0, args,
});
const reg = (id: bigint, owner = OWNER) => idLog("Registered", { agentId: id, agentURI: `ipfs://${id}`, owner });
const requested = (id: bigint) => poolLog("LineRequested", { agentId: id, owner: OWNER, amount: 5n });
const opened = (id: bigint) => poolLog("LineOpened", { agentId: id, backer: OWNER, amount: 5n, lockedShares: 5n });
const closed = (id: bigint) => poolLog("LineClosed", { agentId: id });

// creditReport tuple: score, repaidCount, qualifiedRepaid, dollarDays, lineAmount, backer, firstRepaidAt, defaulted, openLoanId
type Report = readonly [bigint, bigint, bigint, bigint, bigint, string, bigint, boolean, bigint];
const report = (o: { score?: bigint; repaid?: bigint; qualified?: bigint; line?: bigint; defaulted?: boolean } = {}): Report => [
  o.score ?? 0n, o.repaid ?? 0n, o.qualified ?? 0n, 0n, o.line ?? 0n, OWNER, 0n, o.defaulted ?? false, 0n,
];

/** Mock client. multicall (allowFailure:false) returns bare tuples, exactly like viem. */
function mockClient(logs: Log[], reports: Record<string, Report> = {}): PublicClient {
  const get = (id: bigint) => reports[id.toString()] ?? report();
  return {
    getBlockNumber: async () => 100n,
    getLogs: async ({ address }: { address: string }) => logs.filter((l) => l.address === address),
    readContract: async ({ functionName, args }: { functionName: string; args?: [bigint] }) =>
      functionName === "creditReport" ? get(args![0]) : 0n,
    multicall: async ({ contracts }: { contracts: { args: [bigint] }[] }) => contracts.map((c) => get(c.args[0])),
  } as unknown as PublicClient;
}

async function statusOf(logs: Log[], reports: Record<string, Report> = {}) {
  const res = await createIndexer(cfg, mockClient(logs, reports)).getAgents();
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
    expect(stats.agents).toBe(0);
    expect(await ix.getAgents()).toEqual({ ok: false, items: [] });
  });

  it("returns empty state when addresses are unset", async () => {
    const ix = createIndexer({ identity: undefined, pool: undefined, deployBlock: 0n }, {} as PublicClient);
    expect((await ix.getStats()).ok).toBe(false);
  });

  it("status derives correctly and credit report fields are parsed", async () => {
    const logs = [reg(1n), reg(2n), reg(3n), requested(2n), requested(3n), opened(3n)];
    const client = mockClient(logs, {
      "3": report({ score: 612n, repaid: 4n, qualified: 3n, line: 5n }),
    });
    const res = await createIndexer(cfg, client).getAgents();
    expect(res.ok).toBe(true);
    expect(Object.fromEntries(res.items.map((a) => [a.id, a.status]))).toEqual({
      1: "registered", 2: "requested", 3: "active",
    });
    const a3 = res.items.find((a) => a.id === 3)!;
    expect(a3.score).toBe(612);
    expect(a3.repaidCount).toBe(4);
    expect(a3.qualifiedRepaid).toBe(3);
    expect(a3.lineAmount).toBe(5n);
    expect(a3.defaulted).toBe(false);
  });

  it("falls back to per-agent reads when multicall fails", async () => {
    const client = mockClient([reg(1n), opened(1n)], { "1": report({ score: 700n, line: 9n }) });
    (client as unknown as { multicall: () => Promise<never> }).multicall = async () => {
      throw new Error("no multicall3");
    };
    const res = await createIndexer(cfg, client).getAgents();
    expect(res.items[0].score).toBe(700);
    expect(res.items[0].lineAmount).toBe(9n);
  });

  it("Defaulted event gives defaulted status and counts defaults", async () => {
    const logs = [reg(1n), opened(1n), poolLog("Defaulted", { loanId: 1n, agentId: 1n, burnedShares: 1n })];
    const ix = createIndexer(cfg, mockClient(logs));
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
    const ix = createIndexer(cfg, mockClient(logs));
    expect((await ix.getAgent(1)).item?.owner).toBe(OWNER2);
    expect((await ix.getAgentsByOwner(OWNER2)).items.map((a) => a.id)).toEqual([1]);
    expect((await ix.getAgentsByOwner(OWNER)).items).toEqual([]);
  });
});
