import {
  erc20Abi,
  formatUnits,
  getAbiItem,
  parseEventLogs,
  parseUnits,
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { z, type ZodRawShape } from "zod";
import { identityAbi } from "./abi/ElyrionIdentity.js";
import { poolAbi } from "./abi/ElyrionPool.js";
import { buildAgentURI, validateRegistration } from "./agent-uri.js";
import { CHAIN_ID, explorerTxUrl } from "./chain.js";

const USDC_DECIMALS = 6;
const DAY = 86_400n;
const FEE_BPS = 100n;
const MIN_USD = 5;
const MAX_USD = 50;

/** An error whose message is safe and readable to show to the agent. */
export class ToolError extends Error {}

export interface ToolContext {
  config: { identity: Address; pool: Address; fromBlock: bigint };
  publicClient: PublicClient;
  /** Throws a readable error when no usable key is configured. Only write tools call it. */
  getWallet: () => { account: Account; client: WalletClient };
  /** Strings to scrub from any error text (the private key). */
  secrets?: string[];
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  /** Read-only tools never need a wallet. */
  readOnly: boolean;
  handler: (ctx: ToolContext, args: never) => Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------- helpers

const usdc = (v: bigint) => formatUnits(v, USDC_DECIMALS);
const iso = (unixSeconds: bigint) => new Date(Number(unixSeconds) * 1000).toISOString();

/** Contract fee formula: ceil(amount * 100 * term / (30 days * 10000)). */
export function previewFee(amount: bigint, termSeconds: bigint): bigint {
  const denom = 30n * DAY * 10_000n;
  return (amount * FEE_BPS * termSeconds + denom - 1n) / denom;
}

const agentIdSchema = z.number().int().positive().safe().describe("Agent id from register_agent");

function usdAmount(label: string) {
  return z
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .min(MIN_USD, `${label} must be between $${MIN_USD} and $${MAX_USD}`)
    .max(MAX_USD, `${label} must be between $${MIN_USD} and $${MAX_USD}`)
    .refine((n) => /^\d+(\.\d{1,6})?$/.test(n.toString()), `${label} can have at most 6 decimal places`);
}

const toUnits = (usd: number) => parseUnits(usd.toString(), USDC_DECIMALS);

async function assertChain(ctx: ToolContext) {
  const id = await ctx.publicClient.getChainId();
  if (id !== CHAIN_ID) {
    throw new ToolError(`RPC is on chain ${id}, expected Elysium (chain id ${CHAIN_ID}). Check ELYRION_RPC_URL.`);
  }
}

interface WriteCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

async function sendTx(ctx: ToolContext, call: WriteCall) {
  const { account, client } = ctx.getWallet();
  await assertChain(ctx);
  const { request } = await ctx.publicClient.simulateContract({ account, ...call } as never);
  const hash: Hex = await client.writeContract(request as never);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new ToolError(`Transaction ${hash} reverted on-chain: ${explorerTxUrl(hash)}`);
  }
  return { hash, receipt };
}

const txOut = (hash: Hex, summary: string) => ({ txHash: hash, explorerUrl: explorerTxUrl(hash), summary });

type Loan = {
  agentId: bigint;
  borrower: Address;
  principal: bigint;
  fee: bigint;
  start: bigint;
  term: bigint;
  dueAt: bigint;
  status: number;
};

// ---------------------------------------------------------------- tools

const registerAgent: ToolDef = {
  name: "register_agent",
  description:
    "Register a new AI agent identity on Elyrion (ERC-8004 compatible). Mints an agent id owned by the wallet in ELYRION_AGENT_KEY.",
  readOnly: false,
  inputSchema: {
    name: z.string().describe("Agent name, 2-64 characters"),
    description: z.string().describe("What the agent does, up to 280 characters (may be empty)"),
    endpoint: z.string().describe("https:// URL where the agent can be reached, or empty"),
  },
  async handler(ctx, args: { name: string; description: string; endpoint: string }) {
    const problems = validateRegistration(args);
    if (problems.length) throw new ToolError(`Invalid registration: ${problems.join("; ")}.`);
    const agentURI = buildAgentURI(args);
    const { hash, receipt } = await sendTx(ctx, {
      address: ctx.config.identity,
      abi: identityAbi,
      functionName: "register",
      args: [agentURI],
    });
    const registered = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: receipt.logs }).find(
      (l) => l.address.toLowerCase() === ctx.config.identity.toLowerCase(),
    );
    if (!registered) throw new ToolError(`Registered, but no Registered event was found. Check ${explorerTxUrl(hash)}.`);
    const agentId = registered.args.agentId;
    return {
      ...txOut(hash, `Registered agent #${agentId} "${args.name.trim()}". Next: request_line to ask for a credit line.`),
      agentId: agentId.toString(),
    };
  },
};

const requestLine: ToolDef = {
  name: "request_line",
  description:
    "Request a USDC credit line ($5-$50) for an agent you own. A lender must still back the request before you can borrow.",
  readOnly: false,
  inputSchema: { agentId: agentIdSchema, amountUsd: usdAmount("amountUsd") },
  async handler(ctx, args: { agentId: number; amountUsd: number }) {
    const amount = toUnits(args.amountUsd);
    const { hash } = await sendTx(ctx, {
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "requestLine",
      args: [BigInt(args.agentId), amount],
    });
    return txOut(
      hash,
      `Requested a ${usdc(amount)} USDC credit line for agent #${args.agentId}. It becomes usable once a lender backs it.`,
    );
  },
};

const checkScore: ToolDef = {
  name: "check_score",
  description: "Read an agent's Ely Score and repayment history (read-only, no key needed).",
  readOnly: true,
  inputSchema: { agentId: agentIdSchema },
  async handler(ctx, args: { agentId: number }) {
    await assertChain(ctx);
    const r = (await ctx.publicClient.readContract({
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "creditReport",
      args: [BigInt(args.agentId)],
    })) as readonly [bigint, bigint, bigint, bigint, bigint, Address, bigint, boolean, bigint];
    return {
      agentId: String(args.agentId),
      score: Number(r[0]),
      repaidCount: Number(r[1]),
      qualifiedRepaid: Number(r[2]),
      dollarDays: r[3].toString(),
      lineAmountUsdc: usdc(r[4]),
      backer: r[5],
      firstRepaidAt: r[6] === 0n ? null : iso(r[6]),
      defaulted: r[7],
      openLoanId: r[8] === 0n ? null : r[8].toString(),
    };
  },
};

const getLine: ToolDef = {
  name: "get_line",
  description: "Read an agent's credit line, pending request and open loan (read-only, no key needed).",
  readOnly: true,
  inputSchema: { agentId: agentIdSchema },
  async handler(ctx, args: { agentId: number }) {
    await assertChain(ctx);
    const id = BigInt(args.agentId);
    const [line, pending, report] = await Promise.all([
      ctx.publicClient.readContract({ address: ctx.config.pool, abi: poolAbi, functionName: "lines", args: [id] }),
      ctx.publicClient.readContract({ address: ctx.config.pool, abi: poolAbi, functionName: "pendingRequest", args: [id] }),
      ctx.publicClient.readContract({ address: ctx.config.pool, abi: poolAbi, functionName: "creditReport", args: [id] }),
    ]);
    const [backer, amount] = line as readonly [Address, bigint, bigint];
    const openLoanId = (report as readonly bigint[])[8];
    const active = backer !== "0x0000000000000000000000000000000000000000";
    return {
      agentId: String(args.agentId),
      status: active ? "active" : (pending as bigint) > 0n ? "requested" : "none",
      lineAmountUsdc: usdc(amount),
      backer: active ? backer : null,
      pendingRequestUsdc: usdc(pending as bigint),
      openLoanId: openLoanId === 0n ? null : openLoanId.toString(),
    };
  },
};

const getLoans: ToolDef = {
  name: "get_loans",
  description: "List an agent's loans from Borrowed / Repaid / Defaulted events (read-only, no key needed).",
  readOnly: true,
  inputSchema: { agentId: agentIdSchema },
  async handler(ctx, args: { agentId: number }) {
    await assertChain(ctx);
    const agentId = BigInt(args.agentId);
    const base = { address: ctx.config.pool, fromBlock: ctx.config.fromBlock, toBlock: "latest" as const };
    const logs = (name: "Borrowed" | "Repaid" | "Defaulted") =>
      ctx.publicClient.getLogs({
        ...base,
        event: getAbiItem({ abi: poolAbi, name }),
        args: { agentId },
      } as never) as unknown as Promise<{ args: Record<string, bigint> }[]>;
    const [borrowed, repaid, defaulted] = await Promise.all([logs("Borrowed"), logs("Repaid"), logs("Defaulted")]);
    const repaidIds = new Set(repaid.map((l) => l.args.loanId));
    const defaultedIds = new Set(defaulted.map((l) => l.args.loanId));
    const loans = borrowed
      .map((l) => ({
        loanId: l.args.loanId,
        principal: l.args.amount,
        fee: l.args.fee,
        dueAt: l.args.dueAt,
      }))
      .sort((a, b) => (a.loanId < b.loanId ? -1 : a.loanId > b.loanId ? 1 : 0))
      .map((l) => ({
        loanId: l.loanId.toString(),
        principalUsdc: usdc(l.principal),
        feeUsdc: usdc(l.fee),
        dueAt: iso(l.dueAt),
        status: repaidIds.has(l.loanId) ? "repaid" : defaultedIds.has(l.loanId) ? "defaulted" : "open",
      }));
    return { agentId: String(args.agentId), loans };
  },
};

const borrow: ToolDef = {
  name: "borrow",
  description:
    "Borrow USDC ($5-$50) for 1-7 days against an agent's credit line. The fee is 1% per 30 days, prorated. Repay with repay.",
  readOnly: false,
  inputSchema: {
    agentId: agentIdSchema,
    amountUsd: usdAmount("amountUsd"),
    termDays: z
      .number()
      .int("termDays must be a whole number of days")
      .min(1, "termDays must be between 1 and 7")
      .max(7, "termDays must be between 1 and 7"),
  },
  async handler(ctx, args: { agentId: number; amountUsd: number; termDays: number }) {
    const amount = toUnits(args.amountUsd);
    const term = BigInt(args.termDays) * DAY;
    const fee = previewFee(amount, term);
    const { hash, receipt } = await sendTx(ctx, {
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "borrow",
      args: [BigInt(args.agentId), amount, term],
    });
    const ev = parseEventLogs({ abi: poolAbi, eventName: "Borrowed", logs: receipt.logs }).find(
      (l) => l.address.toLowerCase() === ctx.config.pool.toLowerCase(),
    );
    let dueAt: bigint;
    if (ev) dueAt = ev.args.dueAt;
    else dueAt = (await ctx.publicClient.getBlock({ blockNumber: receipt.blockNumber })).timestamp + term;
    const loanNote = ev ? ` (loan #${ev.args.loanId})` : "";
    return txOut(
      hash,
      `Borrowed ${usdc(amount)} USDC for agent #${args.agentId}${loanNote}. Fee ${usdc(fee)} USDC, ` +
        `total to repay ${usdc(amount + fee)} USDC by ${iso(dueAt)}.`,
    );
  },
};

const repay: ToolDef = {
  name: "repay",
  description:
    "Repay an open loan (principal + fee in USDC). Approves exactly that amount to the pool first if the allowance is short.",
  readOnly: false,
  inputSchema: { loanId: z.number().int().positive().safe().describe("Loan id") },
  async handler(ctx, args: { loanId: number }) {
    await assertChain(ctx);
    const loanId = BigInt(args.loanId);
    const loan = (await ctx.publicClient.readContract({
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "getLoan",
      args: [loanId],
    })) as Loan;
    if (loan.principal === 0n) throw new ToolError(`Loan #${args.loanId} does not exist.`);
    if (Number(loan.status) !== 0) {
      throw new ToolError(`Loan #${args.loanId} is not open (already ${Number(loan.status) === 1 ? "repaid" : "defaulted"}).`);
    }
    const total = loan.principal + loan.fee;
    const { account } = ctx.getWallet();
    const usdcAddress = (await ctx.publicClient.readContract({
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "usdc",
    })) as Address;
    const allowance = (await ctx.publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, ctx.config.pool],
    })) as bigint;
    let approveNote = "";
    if (allowance < total) {
      const a = await sendTx(ctx, {
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [ctx.config.pool, total],
      });
      approveNote = ` Approved ${usdc(total)} USDC first (${explorerTxUrl(a.hash)}).`;
    }
    const { hash } = await sendTx(ctx, {
      address: ctx.config.pool,
      abi: poolAbi,
      functionName: "repay",
      args: [loanId],
    });
    return txOut(
      hash,
      `Repaid loan #${args.loanId}: ${usdc(loan.principal)} USDC principal + ${usdc(loan.fee)} USDC fee = ${usdc(total)} USDC.${approveNote}`,
    );
  },
};

export const tools: ToolDef[] = [registerAgent, requestLine, checkScore, getLine, getLoans, borrow, repay];

// ---------------------------------------------------------------- dispatch

function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (!s) continue;
    const bare = s.replace(/^0x/i, "");
    for (const needle of [s, bare]) out = out.split(needle).join("[redacted]");
  }
  return out;
}

/** Readable, single-block error text: no stack, no secrets. */
export function errorMessage(err: unknown, secrets: string[] = []): string {
  let msg: string;
  if (err instanceof ToolError) msg = err.message;
  else if (err instanceof z.ZodError) {
    msg = "Invalid arguments: " + err.issues.map((i) => i.message).join("; ");
  } else if (err && typeof err === "object" && typeof (err as { shortMessage?: unknown }).shortMessage === "string") {
    msg = (err as { shortMessage: string }).shortMessage;
    // Surface the contract's custom error name (e.g. NoLine, BadAmount, OpenLoan) when viem decoded one.
    const walk = (err as { walk?: (fn: (e: unknown) => boolean) => unknown }).walk;
    const inner = typeof walk === "function" ? walk.call(err, (e) => typeof (e as { data?: { errorName?: unknown } })?.data?.errorName === "string") : undefined;
    const name = (inner as { data?: { errorName?: string } } | undefined)?.data?.errorName;
    if (name) msg += ` (contract error: ${name})`;
  } else if (err instanceof Error) {
    msg = err.message.split("\n")[0] ?? "Unknown error";
  } else msg = "Unknown error";
  msg = scrub(msg, secrets);
  return msg.length > 400 ? msg.slice(0, 397) + "..." : msg;
}

export async function callTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolResult> {
  try {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new ToolError(`Unknown tool: ${name}`);
    const args = z.object(tool.inputSchema).parse(rawArgs ?? {});
    const out = await tool.handler(ctx, args as never);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: errorMessage(err, ctx.secrets) }] };
  }
}
