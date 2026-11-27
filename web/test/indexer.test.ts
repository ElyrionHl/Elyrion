import { describe, expect, it } from "vitest";
import { createPublicClient, custom, type PublicClient } from "viem";
import { createIndexer } from "../lib/indexer";
import { elysium } from "../lib/chain";

const IDENTITY = "0x00000000000000000000000000000000000000a1";
const POOL = "0x00000000000000000000000000000000000000b2";
const OWNER = "0x00000000000000000000000000000000000000c3";
const cfg = { identity: IDENTITY, pool: POOL, deployBlock: 0n, houseOwner: undefined } as const;

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
    const agents = await ix.getAgents();
    expect(agents).toEqual({ ok: false, items: [] });
  });

  it("returns empty state when addresses are unset", async () => {
    const ix = createIndexer({ identity: undefined, pool: undefined, deployBlock: 0n }, {} as PublicClient);
    expect((await ix.getStats()).ok).toBe(false);
  });

  it("status derives correctly", async () => {
    const reg = (id: bigint, block: bigint) => ({
      address: IDENTITY, eventName: "Registered", blockNumber: block, logIndex: 0,
      args: { agentId: id, agentURI: `ipfs://${id}`, owner: OWNER },
    });
    const logs = [
      reg(1n, 1n),
      reg(2n, 2n),
      reg(3n, 3n),
      { address: POOL, eventName: "LineRequested", blockNumber: 4n, logIndex: 0, args: { agentId: 2n, owner: OWNER, amount: 5n } },
      { address: POOL, eventName: "LineRequested", blockNumber: 5n, logIndex: 0, args: { agentId: 3n, owner: OWNER, amount: 5n } },
      { address: POOL, eventName: "LineOpened", blockNumber: 6n, logIndex: 0, args: { agentId: 3n, backer: OWNER, amount: 5n, lockedShares: 5n } },
    ];
    const report = (lineAmount: bigint) => ({
      status: "success",
      result: [10n, 0n, 0n, 0n, lineAmount, OWNER, 0n, false, 0n],
    });
    const client = {
      getBlockNumber: async () => 10n,
      getLogs: async ({ address }: { address: string }) => logs.filter((l) => l.address === address),
      readContract: async () => 0n,
      multicall: async ({ contracts }: { contracts: { args: [bigint] }[] }) =>
        contracts.map((c) => report(c.args[0] === 3n ? 5n : 0n)),
    } as unknown as PublicClient;
    const ix = createIndexer(cfg, client);
    const res = await ix.getAgents();
    expect(res.ok).toBe(true);
    const by = Object.fromEntries(res.items.map((a) => [a.id, a.status]));
    expect(by).toEqual({ 1: "registered", 2: "requested", 3: "active" });
  });
});
