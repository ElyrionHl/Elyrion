import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { identityAbi } from "../src/abi/ElyrionIdentity.js";
import { poolAbi } from "../src/abi/ElyrionPool.js";
import { buildAgentURI, REGISTRATION_TYPE } from "../src/agent-uri.js";
import { callTool, tools, type ToolContext } from "../src/tools.js";

const IDENTITY = "0x1111111111111111111111111111111111111111" as Address;
const POOL = "0x2222222222222222222222222222222222222222" as Address;
const USDC = "0x3333333333333333333333333333333333333333" as Address;
const OWNER = "0x4444444444444444444444444444444444444444" as Address;
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TX = ("0x" + "ab".repeat(32)) as Hex;

function registeredLog(agentId: bigint, uri: string, address = IDENTITY) {
  const topics = encodeEventTopics({ abi: identityAbi, eventName: "Registered", args: { agentId, owner: OWNER } });
  return { address, topics, data: encodeAbiParameters([{ type: "string" }], [uri]) };
}
function borrowedLog(loanId: bigint, agentId: bigint, amount: bigint, fee: bigint, dueAt: bigint) {
  const topics = encodeEventTopics({ abi: poolAbi, eventName: "Borrowed", args: { loanId, agentId, borrower: OWNER } });
  return {
    address: POOL,
    topics,
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [amount, fee, dueAt],
    ),
  };
}

interface MockOpts {
  logs?: unknown[];
  allowance?: bigint;
  loan?: Record<string, unknown>;
  getLogs?: (a: { event: { name: string } }) => unknown[];
}

function makeCtx(opts: MockOpts = {}, withKey = true) {
  const writeContract = vi.fn(async () => TX);
  const publicClient = {
    getChainId: vi.fn(async () => 99901),
    getBlock: vi.fn(async () => ({ timestamp: 1_000_000n })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "creditReport":
          return [525n, 2n, 1n, 40n, 20_000_000n, OWNER, 1_700_000_000n, false, 0n];
        case "lines":
          return [OWNER, 20_000_000n, 5n];
        case "pendingRequest":
          return 0n;
        case "usdc":
          return USDC;
        case "allowance":
          return opts.allowance ?? 0n;
        case "getLoan":
          return (
            opts.loan ?? {
              agentId: 1n,
              borrower: OWNER,
              principal: 10_000_000n,
              fee: 3_334n,
              start: 1n,
              term: 86_400n,
              dueAt: 86_401n,
              status: 0,
            }
          );
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    }),
    simulateContract: vi.fn(async (a: Record<string, unknown>) => ({ request: a })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", logs: opts.logs ?? [], blockNumber: 5n })),
    getLogs: vi.fn(async (a: { event: { name: string } }) => (opts.getLogs ? opts.getLogs(a) : [])),
  };
  const ctx: ToolContext = {
    config: { identity: IDENTITY, pool: POOL, fromBlock: 0n },
    publicClient: publicClient as never,
    getWallet: withKey
      ? () => ({ account: { address: OWNER } as never, client: { writeContract } as never })
      : () => {
          throw new Error("ELYRION_AGENT_KEY is not set.");
        },
    secrets: withKey ? [KEY] : [],
  };
  return { ctx, publicClient, writeContract };
}

const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

describe("tool list", () => {
  it("exposes exactly the documented tools", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "register_agent",
      "request_line",
      "check_score",
      "get_line",
      "get_loans",
      "borrow",
      "repay",
    ]);
  });
});

describe("borrow validation", () => {
  it("borrow rejects 4.99 and 51", async () => {
    const { ctx, writeContract } = makeCtx();
    for (const amountUsd of [4.99, 51]) {
      const r = await callTool(ctx, "borrow", { agentId: 1, amountUsd, termDays: 1 });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/amountUsd/);
    }
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("borrow rejects term 0 and 8", async () => {
    const { ctx, writeContract } = makeCtx();
    for (const termDays of [0, 8]) {
      const r = await callTool(ctx, "borrow", { agentId: 1, amountUsd: 5, termDays });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/termDays/);
    }
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("rejects more than 6 decimals and non-integer terms", async () => {
    const { ctx } = makeCtx();
    expect((await callTool(ctx, "borrow", { agentId: 1, amountUsd: 5.1234567, termDays: 1 })).isError).toBe(true);
    expect((await callTool(ctx, "borrow", { agentId: 1, amountUsd: 5, termDays: 1.5 })).isError).toBe(true);
  });
});

describe("borrow", () => {
  it("summary includes fee 0.001667 for $5/1d", async () => {
    const dueAt = 1_800_086_400n;
    const { ctx, writeContract, publicClient } = makeCtx({
      logs: [borrowedLog(3n, 1n, 5_000_000n, 1_667n, dueAt)],
    });
    const r = await callTool(ctx, "borrow", { agentId: 1, amountUsd: 5, termDays: 1 });
    expect(r.isError).toBeUndefined();
    const out = JSON.parse(text(r));
    expect(out.txHash).toBe(TX);
    expect(out.explorerUrl).toBe(`https://elysium.kinetiq.xyz/tx/${TX}`);
    expect(out.summary).toContain("0.001667");
    expect(out.summary).toContain("5 USDC");
    expect(out.summary).toContain(new Date(Number(dueAt) * 1000).toISOString());
    const call = publicClient.simulateContract.mock.calls[0][0] as Record<string, unknown>;
    expect(call.functionName).toBe("borrow");
    expect(call.address).toBe(POOL);
    expect(call.args).toEqual([1n, 5_000_000n, 86_400n]);
    expect(writeContract).toHaveBeenCalledOnce();
  });

  it("falls back to block time + term when the Borrowed log is missing", async () => {
    const { ctx } = makeCtx();
    const r = await callTool(ctx, "borrow", { agentId: 1, amountUsd: 10, termDays: 2 });
    const out = JSON.parse(text(r));
    expect(out.summary).toContain(new Date((1_000_000 + 172_800) * 1000).toISOString());
  });
});

describe("secrets", () => {
  it("key never appears in tool output", async () => {
    const { ctx } = makeCtx({
      logs: [registeredLog(7n, "x"), borrowedLog(1n, 1n, 5_000_000n, 1_667n, 100n)],
      allowance: 0n,
    });
    const outputs = [
      await callTool(ctx, "register_agent", { name: "Bot", description: "d", endpoint: "" }),
      await callTool(ctx, "request_line", { agentId: 1, amountUsd: 20 }),
      await callTool(ctx, "check_score", { agentId: 1 }),
      await callTool(ctx, "get_line", { agentId: 1 }),
      await callTool(ctx, "borrow", { agentId: 1, amountUsd: 5, termDays: 1 }),
      await callTool(ctx, "repay", { loanId: 1 }),
    ];
    for (const o of outputs) {
      const s = JSON.stringify(o);
      expect(s).not.toContain(KEY);
      expect(s).not.toContain(KEY.slice(2));
    }
  });

  it("key is redacted from error messages and stacks are not returned", async () => {
    const { ctx, publicClient } = makeCtx();
    publicClient.simulateContract.mockRejectedValueOnce(new Error(`boom ${KEY}\n    at secret.ts:1:1`));
    const r = await callTool(ctx, "request_line", { agentId: 1, amountUsd: 20 });
    expect(r.isError).toBe(true);
    const s = text(r);
    expect(s).not.toContain(KEY);
    expect(s).not.toContain(KEY.slice(2));
    expect(s).not.toContain("secret.ts");
  });
});

describe("read tools", () => {
  it("read tools work without ELYRION_AGENT_KEY", async () => {
    const { ctx } = makeCtx(
      {
        getLogs: ({ event }) =>
          event.name === "Borrowed"
            ? [{ args: { loanId: 1n, agentId: 1n, borrower: OWNER, amount: 5_000_000n, fee: 1_667n, dueAt: 86_500n }, blockNumber: 2n }]
            : [],
      },
      false,
    );
    const score = JSON.parse(text(await callTool(ctx, "check_score", { agentId: 1 })));
    expect(score.score).toBe(525);
    expect(score.defaulted).toBe(false);
    const line = JSON.parse(text(await callTool(ctx, "get_line", { agentId: 1 })));
    expect(line.lineAmountUsdc).toBe("20");
    const loans = JSON.parse(text(await callTool(ctx, "get_loans", { agentId: 1 })));
    expect(loans.loans).toEqual([
      expect.objectContaining({ loanId: "1", principalUsdc: "5", feeUsdc: "0.001667", status: "open" }),
    ]);
  });

  it("write tools without a key give a readable error", async () => {
    const { ctx } = makeCtx({}, false);
    const r = await callTool(ctx, "request_line", { agentId: 1, amountUsd: 20 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("ELYRION_AGENT_KEY");
  });

  it("get_loans marks repaid and defaulted loans", async () => {
    const b = (id: bigint) => ({
      args: { loanId: id, agentId: 1n, borrower: OWNER, amount: 5_000_000n, fee: 1_667n, dueAt: 100n },
      blockNumber: id,
    });
    const { ctx } = makeCtx({
      getLogs: ({ event }) =>
        event.name === "Borrowed"
          ? [b(1n), b(2n), b(3n)]
          : event.name === "Repaid"
            ? [{ args: { loanId: 1n, agentId: 1n } }]
            : [{ args: { loanId: 2n, agentId: 1n } }],
    });
    const loans = JSON.parse(text(await callTool(ctx, "get_loans", { agentId: 1 }))).loans;
    expect(loans.map((l: { status: string }) => l.status)).toEqual(["repaid", "defaulted", "open"]);
  });
});

describe("register_agent", () => {
  it("builds the website agentURI and parses agentId from the Identity event", async () => {
    const input = { name: "Zed ✨", description: "does things", endpoint: "https://zed.example/mcp" };
    const uri = buildAgentURI(input);
    const { ctx, publicClient } = makeCtx({
      logs: [registeredLog(99n, "other", "0x5555555555555555555555555555555555555555" as Address), registeredLog(7n, uri)],
    });
    const out = JSON.parse(text(await callTool(ctx, "register_agent", input)));
    expect(out.agentId).toBe("7");
    expect(out.summary).toContain("#7");
    const call = publicClient.simulateContract.mock.calls[0][0] as { args: string[]; address: string };
    expect(call.address).toBe(IDENTITY);
    expect(call.args[0]).toBe(uri);
    const json = JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString("utf8"));
    expect(json).toEqual({ ...input, type: REGISTRATION_TYPE });
  });

  it("validates name, description and endpoint", async () => {
    const { ctx, writeContract } = makeCtx();
    for (const bad of [
      { name: "x", description: "", endpoint: "" },
      { name: "n".repeat(65), description: "", endpoint: "" },
      { name: "ok", description: "d".repeat(281), endpoint: "" },
      { name: "ok", description: "", endpoint: "http://insecure.example" },
    ]) {
      expect((await callTool(ctx, "register_agent", bad)).isError).toBe(true);
    }
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("errors when no Registered event came from the Identity address", async () => {
    const { ctx } = makeCtx({ logs: [] });
    const r = await callTool(ctx, "register_agent", { name: "Bot", description: "", endpoint: "" });
    expect(r.isError).toBe(true);
  });
});

describe("request_line", () => {
  it("validates $5-$50 and sends requestLine", async () => {
    const { ctx, publicClient } = makeCtx();
    expect((await callTool(ctx, "request_line", { agentId: 1, amountUsd: 4 })).isError).toBe(true);
    expect((await callTool(ctx, "request_line", { agentId: 1, amountUsd: 60 })).isError).toBe(true);
    const out = JSON.parse(text(await callTool(ctx, "request_line", { agentId: 1, amountUsd: 20 })));
    expect(out.txHash).toBe(TX);
    const call = publicClient.simulateContract.mock.calls[0][0] as Record<string, unknown>;
    expect(call.functionName).toBe("requestLine");
    expect(call.args).toEqual([1n, 20_000_000n]);
  });
});

describe("repay", () => {
  it("approves exactly principal+fee when allowance is short, then repays", async () => {
    const { ctx, publicClient } = makeCtx({ allowance: 0n });
    const out = JSON.parse(text(await callTool(ctx, "repay", { loanId: 1 })));
    const fns = publicClient.simulateContract.mock.calls.map((c) => (c[0] as { functionName: string }).functionName);
    expect(fns).toEqual(["approve", "repay"]);
    const approve = publicClient.simulateContract.mock.calls[0][0] as { address: string; args: unknown[] };
    expect(approve.address).toBe(USDC);
    expect(approve.args).toEqual([POOL, 10_003_334n]);
    expect(out.summary).toContain("10.003334");
  });

  it("skips approve when allowance is sufficient", async () => {
    const { ctx, publicClient } = makeCtx({ allowance: 10_003_334n });
    await callTool(ctx, "repay", { loanId: 1 });
    const fns = publicClient.simulateContract.mock.calls.map((c) => (c[0] as { functionName: string }).functionName);
    expect(fns).toEqual(["repay"]);
  });

  it("refuses a loan that is not open", async () => {
    const { ctx, writeContract } = makeCtx({
      loan: { agentId: 1n, borrower: OWNER, principal: 1n, fee: 1n, start: 1n, term: 1n, dueAt: 2n, status: 1 },
    });
    const r = await callTool(ctx, "repay", { loanId: 1 });
    expect(r.isError).toBe(true);
    expect(writeContract).not.toHaveBeenCalled();
  });
});

describe("chain pinning", () => {
  it("refuses an RPC that is not chain 99901", async () => {
    const { ctx, publicClient } = makeCtx();
    publicClient.getChainId.mockResolvedValue(1);
    const r = await callTool(ctx, "check_score", { agentId: 1 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("99901");
  });
});
