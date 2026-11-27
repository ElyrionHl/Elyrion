/**
 * Elyrion house agent: keeps one small loan cycling so the board always shows a live, honest record.
 *
 *   pnpm tsx scripts/house-agent.ts
 *
 * Env: ELYRION_AGENT_KEY (house agent owner's key), ELYRION_IDENTITY, ELYRION_POOL, HOUSE_AGENT_ID,
 *      optional ELYRION_RPC_URL, HOUSE_AGENT_INTERVAL_SEC (default 300).
 * Every 5 minutes: no open loan → borrow $5 for 4 days; open loan held >= 3 days + 10 minutes → repay.
 * Transactions go through the MCP server's own tools (callTool), so the tx logic lives in one place.
 * The key is never printed: tool errors are scrubbed by callTool, and this script logs only addresses and hashes.
 */
import { ConfigError, loadConfig, makeClients } from "../mcp/src/chain.js";
import { poolAbi } from "../mcp/src/abi/ElyrionPool.js";
import { identityAbi } from "../mcp/src/abi/ElyrionIdentity.js";
import { callTool, errorMessage, type ToolContext } from "../mcp/src/tools.js";
import {
  decideHouseAction,
  HOUSE_BORROW_USD,
  HOUSE_TERM_DAYS,
  loanStatus,
  type HouseLoan,
} from "./house-logic.js";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function fail(msg: string): never {
  console.error(`house-agent: ${msg}`);
  process.exit(1);
}

function setup() {
  const config = (() => {
    try {
      return loadConfig();
    } catch (e) {
      return fail(e instanceof ConfigError ? e.message : "could not read the environment.");
    }
  })();
  const rawId = process.env.HOUSE_AGENT_ID?.trim() ?? "";
  if (!/^[1-9]\d{0,12}$/.test(rawId)) fail("HOUSE_AGENT_ID must be set to the house agent's id (a positive integer).");
  const rawInterval = process.env.HOUSE_AGENT_INTERVAL_SEC?.trim();
  const intervalSec = rawInterval ? Number(rawInterval) : 300;
  if (!Number.isInteger(intervalSec) || intervalSec < 5) fail("HOUSE_AGENT_INTERVAL_SEC must be a whole number >= 5.");

  const { publicClient, getWallet } = makeClients(config);
  const ctx: ToolContext = {
    config,
    publicClient,
    getWallet,
    secrets: config.agentKey ? [config.agentKey] : [],
  };
  return { ctx, agentId: Number(rawId), intervalSec };
}

/** Parses a callTool result: JSON on success, readable error text otherwise. */
async function tool(ctx: ToolContext, name: string, args: Record<string, unknown>) {
  const res = await callTool(ctx, name, args);
  const text = res.content[0]?.text ?? "";
  if (res.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

interface Status {
  defaulted: boolean;
  loanId: number | null;
  loan: HouseLoan | null;
  nowSec: number;
}

async function readStatus(ctx: ToolContext, agentId: number): Promise<Status> {
  const report = await tool(ctx, "check_score", { agentId });
  const openLoanId = report.openLoanId === null ? null : Number(report.openLoanId);
  // Chain time, not wall time, so the hold is measured the way the pool measures it.
  const block = await ctx.publicClient.getBlock();
  const nowSec = Number(block.timestamp);
  if (openLoanId === null) return { defaulted: report.defaulted === true, loanId: null, loan: null, nowSec };
  const l = (await ctx.publicClient.readContract({
    address: ctx.config.pool,
    abi: poolAbi,
    functionName: "getLoan",
    args: [BigInt(openLoanId)],
  })) as { start: bigint; dueAt: bigint; status: number };
  return {
    defaulted: report.defaulted === true,
    loanId: openLoanId,
    loan: { status: loanStatus(Number(l.status)), start: Number(l.start), dueAt: Number(l.dueAt) },
    nowSec,
  };
}

const fmtHeld = (sec: number) => `${Math.floor(sec / 86_400)}d ${Math.floor((sec % 86_400) / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;

async function tick(ctx: ToolContext, agentId: number) {
  const s = await readStatus(ctx, agentId);
  if (s.defaulted) {
    log(`wait agent=#${agentId} defaulted; borrowing is closed for this agent`);
    return;
  }
  const action = decideHouseAction(s.loan, s.nowSec);
  if (action === "wait") {
    log(`wait agent=#${agentId} loan=#${s.loanId} held=${fmtHeld(s.nowSec - s.loan!.start)}`);
    return;
  }
  if (action === "borrow") {
    const out = await tool(ctx, "borrow", { agentId, amountUsd: HOUSE_BORROW_USD, termDays: HOUSE_TERM_DAYS });
    log(`borrow agent=#${agentId} tx=${out.txHash} ${out.summary}`);
    return;
  }
  const out = await tool(ctx, "repay", { loanId: s.loanId });
  log(`repay agent=#${agentId} loan=#${s.loanId} tx=${out.txHash} ${out.summary}`);
}

async function main() {
  const { ctx, agentId, intervalSec } = setup();

  // Startup checks: right chain, and the key's wallet owns the house agent (address only; never the key).
  let owner: string;
  let me: string;
  try {
    me = ctx.getWallet().account.address;
    owner = (await ctx.publicClient.readContract({
      address: ctx.config.identity,
      abi: identityAbi,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    })) as string;
  } catch (e) {
    fail(errorMessage(e, ctx.secrets));
  }
  if (owner.toLowerCase() !== me.toLowerCase()) {
    fail(`agent #${agentId} is owned by ${owner}, not by the ELYRION_AGENT_KEY wallet ${me}.`);
  }
  log(`start agent=#${agentId} wallet=${me} pool=${ctx.config.pool} every=${intervalSec}s`);

  let stopping = false;
  let wake: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log(`stop (${sig}); finishing the current step`);
    if (timer) clearTimeout(timer);
    wake?.();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  while (!stopping) {
    try {
      await tick(ctx, agentId);
    } catch (e) {
      log(`error agent=#${agentId} ${errorMessage(e, ctx.secrets)}`);
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, intervalSec * 1000);
    });
    wake = null;
    timer = null;
  }
  log("stopped");
  process.exit(0);
}

void main();
