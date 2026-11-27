import type { Address, PublicClient } from "viem";
import { identityAbi } from "./abi/ElyrionIdentity";
import { poolAbi } from "./abi/ElyrionPool";
import { agentName } from "./agent-uri";
import { byPosition, eventsOf, fetchLogs } from "./logs";

/** Largest line the admin page opens in one click ($50, the pool's MAX_LOAN). */
export const LINE_OPEN_MAX = 50_000_000n;
export const MSG_TREASURY_ONLY = "Treasury wallet only";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Amount the treasury backs for a request: min(request, $50). */
export function openAmount(requested: bigint): bigint {
  return requested < LINE_OPEN_MAX ? requested : LINE_OPEN_MAX;
}

/** Convenience gate only (the contract enforces backer rules): connected wallet == treasury, case-insensitive. */
export function isTreasury(connected: string | undefined, treasury: string | undefined): boolean {
  return !!connected && !!treasury && connected.toLowerCase() === treasury.toLowerCase();
}

/** A LineRequested log, reduced. */
export interface LineRequest {
  agentId: bigint;
  owner: Address;
  amount: bigint;
  block: bigint;
}

/** Current on-chain state of one agent that ever requested a line. */
export interface AgentLineState {
  agentId: bigint;
  name: string;
  /** pendingRequest(agentId); 0 when none. */
  pending: bigint;
  backer: Address;
  lineAmount: bigint;
  defaulted: boolean;
  /** 0 when none. */
  openLoanId: bigint;
}

export interface PendingItem {
  agentId: bigint;
  name: string;
  owner: Address;
  requested: bigint;
  /** What "Open line" backs: min(requested, $50). */
  openAmount: bigint;
  requestedAtBlock: bigint;
}

export interface BackedItem {
  agentId: bigint;
  name: string;
  lineAmount: bigint;
  openLoanId: bigint;
}

/**
 * Pending = has a live pendingRequest, no line and no default (so not yet opened or closed),
 * oldest request first. Backed = active lines whose backer is `treasury`.
 * Owner and request block come from the agent's latest LineRequested log.
 */
export function deriveQueue(
  requests: LineRequest[],
  states: AgentLineState[],
  treasury: string,
): { pending: PendingItem[]; backed: BackedItem[] } {
  const latest = new Map<string, LineRequest>();
  for (const r of requests) {
    const prev = latest.get(r.agentId.toString());
    if (!prev || r.block >= prev.block) latest.set(r.agentId.toString(), r);
  }
  const t = treasury.toLowerCase();
  const pending: PendingItem[] = [];
  const backed: BackedItem[] = [];
  for (const s of states) {
    const hasLine = s.backer.toLowerCase() !== ZERO;
    if (hasLine && s.backer.toLowerCase() === t) {
      backed.push({ agentId: s.agentId, name: s.name, lineAmount: s.lineAmount, openLoanId: s.openLoanId });
    }
    const req = latest.get(s.agentId.toString());
    if (!hasLine && !s.defaulted && s.pending > 0n && req) {
      pending.push({
        agentId: s.agentId,
        name: s.name,
        owner: req.owner,
        requested: s.pending,
        openAmount: openAmount(s.pending),
        requestedAtBlock: req.block,
      });
    }
  }
  pending.sort((a, b) => (a.requestedAtBlock === b.requestedAtBlock ? 0 : a.requestedAtBlock < b.requestedAtBlock ? -1 : 1));
  backed.sort((a, b) => (a.agentId < b.agentId ? -1 : 1));
  return { pending, backed };
}

export interface TreasuryPosition {
  positionAssets: bigint;
  lockedAssets: bigint;
  freeAssets: bigint;
  freeShares: bigint;
  sponsorFees: bigint;
}

export interface AdminState {
  pending: PendingItem[];
  backed: BackedItem[];
  treasury: TreasuryPosition;
}

/** Reads LineRequested logs since `fromBlock`, each requesting agent's current state, and the treasury position. */
export async function readAdminState(
  client: PublicClient,
  cfg: { identity: Address; pool: Address; fromBlock: bigint },
  treasury: Address,
): Promise<AdminState> {
  const read = (functionName: string, args: readonly unknown[] = [], address: Address = cfg.pool, abi: unknown = poolAbi) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<unknown>;

  const latest = await client.getBlockNumber();
  const logs = await fetchLogs(client, cfg.pool, eventsOf(poolAbi, ["LineRequested"]), cfg.fromBlock, latest);
  const requests: LineRequest[] = logs.sort(byPosition).map((l) => ({
    agentId: BigInt(l.args.agentId),
    owner: l.args.owner as Address,
    amount: BigInt(l.args.amount),
    block: l.blockNumber,
  }));
  const ids = [...new Set(requests.map((r) => r.agentId.toString()))].map((x) => BigInt(x));

  const states: AgentLineState[] = await Promise.all(
    ids.map(async (id) => {
      const [pending, line, report, uri] = await Promise.all([
        read("pendingRequest", [id]),
        read("lines", [id]),
        read("creditReport", [id]),
        read("tokenURI", [id], cfg.identity, identityAbi).catch(() => ""),
      ]);
      const [backer, lineAmount] = line as readonly [Address, bigint, bigint];
      const r = report as readonly unknown[];
      return {
        agentId: id,
        name: agentName(String(uri), Number(id)),
        pending: pending as bigint,
        backer,
        lineAmount,
        defaulted: r[7] as boolean,
        openLoanId: r[8] as bigint,
      };
    }),
  );

  const [shares, locked, sponsorFees] = (await Promise.all([
    read("sharesOf", [treasury]),
    read("lockedSharesOf", [treasury]),
    read("sponsorFees", [treasury]),
  ])) as [bigint, bigint, bigint];
  const freeShares = shares > locked ? shares - locked : 0n;
  const [positionAssets, lockedAssets, freeAssets] = (await Promise.all([
    read("convertToAssets", [shares]),
    read("convertToAssets", [locked]),
    read("convertToAssets", [freeShares]),
  ])) as [bigint, bigint, bigint];

  return {
    ...deriveQueue(requests, states, treasury),
    treasury: { positionAssets, lockedAssets, freeAssets, freeShares, sponsorFees },
  };
}
