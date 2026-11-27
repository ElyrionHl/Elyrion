import type { Address, PublicClient } from "viem";
import { identityAbi } from "./abi/ElyrionIdentity";
import { poolAbi } from "./abi/ElyrionPool";
import { agentName, MAX_URI_BYTES } from "./agent-uri";
import { byPosition, CHUNK, CONCURRENCY, eventsOf, fetchLogs, type Ev } from "./logs";

/** The pool's MIN_LOAN: no line may be smaller (the contract enforces it too). */
export const MIN_LINE = 5_000_000n;
/** Treasury policy (spec 5.1): $5 for a new agent… */
export const NEW_AGENT_LINE = 5_000_000n;
/** …$25 once it has repaid STEP_UP_AFTER qualified loans on treasury-backed lines. */
export const STEP_UP_LINE = 25_000_000n;
export const STEP_UP_AFTER = 3;
/** The pool's QUALIFY_HOLD: a repaid loan held at least this long counts as qualified. */
export const QUALIFY_HOLD_SEC = 3n * 86_400n;
/** Blocks behind the head the scan stops at (lagging RPC nodes). */
export const ADMIN_SAFE_LAG = 5n;

export const MSG_TREASURY_ONLY = "Treasury wallet only";
export const MSG_TREASURY_WRONG_CHAIN =
  "The treasury wallet is connected, but on another network. Switch it to Elysium (chain 99901) to manage lines.";
export const MSG_POOL_PAUSED = "The pool is paused: opening lines is disabled until it is unpaused.";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Convenience gate only (the contract enforces backer rules): connected wallet == treasury, case-insensitive. */
export function isTreasury(connected: string | undefined, treasury: string | undefined): boolean {
  return !!connected && !!treasury && connected.toLowerCase() === treasury.toLowerCase();
}

export type AdminGate = "not-configured" | "connect" | "not-treasury" | "wrong-chain" | "ok";

/** Which admin screen to show. A treasury wallet on the wrong network gets its own message. */
export function adminGate(s: {
  configured: boolean;
  connected: boolean;
  onElysium: boolean;
  address?: string;
  treasury?: string;
}): AdminGate {
  if (!s.configured) return "not-configured";
  if (!s.connected) return "connect";
  if (!isTreasury(s.address, s.treasury)) return "not-treasury";
  if (!s.onElysium) return "wrong-chain";
  return "ok";
}

/** Clamps an amount to [MIN_LINE, min(requested, maxLoan)]; null when that range is empty. */
export function clampOpen(amount: bigint, requested: bigint, maxLoan: bigint): bigint | null {
  const hi = requested < maxLoan ? requested : maxLoan;
  if (hi < MIN_LINE) return null;
  return amount < MIN_LINE ? MIN_LINE : amount > hi ? hi : amount;
}

/**
 * Treasury line policy: the default is $5 (clamped); $25 is offered only after STEP_UP_AFTER qualified
 * repayments on loans taken while the treasury backed the agent's line. `max` is the largest editable amount.
 */
export function lineOffers(requested: bigint, maxLoan: bigint, treasuryQualified: number) {
  return {
    defaultAmount: clampOpen(NEW_AGENT_LINE, requested, maxLoan),
    stepUpAmount: treasuryQualified >= STEP_UP_AFTER ? clampOpen(STEP_UP_LINE, requested, maxLoan) : null,
    max: clampOpen(requested, requested, maxLoan),
  };
}

/** A LineRequested log, reduced. */
export interface LineRequest {
  agentId: bigint;
  owner: Address;
  amount: bigint;
  block: bigint;
}

/** Current on-chain state of one agent the queue shows. */
export interface AgentLineState {
  agentId: bigint;
  name: string;
  /** Current NFT owner (ownerOf), not the LineRequested log's owner. */
  owner: Address;
  /** pendingRequest(agentId); 0 when none. */
  pending: bigint;
  backer: Address;
  lineAmount: bigint;
  defaulted: boolean;
  /** 0 when none. */
  openLoanId: bigint;
  score: bigint;
  repaidCount: bigint;
  qualifiedRepaid: bigint;
  /** Every backer that ever opened a line for this agent, oldest first. */
  pastBackers: Address[];
  /** Qualified repayments on loans taken while the treasury backed the line. */
  treasuryQualified: number;
}

export interface PendingItem {
  agentId: bigint;
  name: string;
  owner: Address;
  requested: bigint;
  requestedAtBlock: bigint;
  score: bigint;
  repaidCount: bigint;
  qualifiedRepaid: bigint;
  pastBackers: Address[];
  treasuryQualified: number;
  /** $5 policy default, clamped; null when no valid amount exists. */
  defaultAmount: bigint | null;
  /** $25, only after STEP_UP_AFTER qualified treasury-backed repayments; null otherwise. */
  stepUpAmount: bigint | null;
  /** Largest amount the operator may type. */
  maxAmount: bigint | null;
}

export interface BackedItem {
  agentId: bigint;
  name: string;
  lineAmount: bigint;
  openLoanId: bigint;
}

/**
 * Pending = has a live pendingRequest, no line and no default, oldest request first, with the treasury policy
 * amounts. Backed = active lines whose backer is `treasury`. Request block comes from the latest LineRequested log;
 * the owner shown is the current NFT owner.
 */
export function deriveQueue(
  requests: LineRequest[],
  states: AgentLineState[],
  treasury: string,
  maxLoan: bigint,
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
      const offers = lineOffers(s.pending, maxLoan, s.treasuryQualified);
      pending.push({
        agentId: s.agentId,
        name: s.name,
        owner: s.owner,
        requested: s.pending,
        requestedAtBlock: req.block,
        score: s.score,
        repaidCount: s.repaidCount,
        qualifiedRepaid: s.qualifiedRepaid,
        pastBackers: s.pastBackers,
        treasuryQualified: s.treasuryQualified,
        defaultAmount: offers.defaultAmount,
        stepUpAmount: offers.stepUpAmount,
        maxAmount: offers.max,
      });
    }
  }
  pending.sort((a, b) => (a.requestedAtBlock === b.requestedAtBlock ? 0 : a.requestedAtBlock < b.requestedAtBlock ? -1 : 1));
  backed.sort((a, b) => (a.agentId < b.agentId ? -1 : 1));
  return { pending, backed };
}

// ---------------------------------------------------------------- incremental log scan

/** Line/loan history folded from pool logs. Only advanced by whole, fully fetched windows. */
export interface AdminFold {
  lastScanned: bigint | null;
  /** Latest LineRequested per agent. */
  requests: Map<string, LineRequest>;
  /** Agents whose latest request has not been opened yet. */
  requestOpen: Set<string>;
  /** Backer of each agent's current line. */
  lineBacker: Map<string, Address>;
  /** Every backer that ever opened a line, per agent, in order. */
  pastBackers: Map<string, Address[]>;
  /** Backer of the line at borrow time, per loan. */
  loanBacker: Map<string, { agentId: string; backer: Address }>;
  /** Repaid loans per agent with the repay block. */
  repaid: Map<string, { loanId: bigint; block: bigint }[]>;
}

export function emptyAdminFold(): AdminFold {
  return {
    lastScanned: null,
    requests: new Map(),
    requestOpen: new Set(),
    lineBacker: new Map(),
    pastBackers: new Map(),
    loanBacker: new Map(),
    repaid: new Map(),
  };
}

/** Folds pool logs (any order within the batch; sorted here) into `f`. */
export function foldAdminLogs(f: AdminFold, logs: Ev[]): void {
  for (const l of [...logs].sort(byPosition)) {
    const a = l.args;
    const id = String(a.agentId);
    switch (l.eventName) {
      case "LineRequested":
        f.requests.set(id, { agentId: BigInt(a.agentId), owner: a.owner as Address, amount: BigInt(a.amount), block: l.blockNumber });
        f.requestOpen.add(id);
        break;
      case "LineOpened": {
        const backer = a.backer as Address;
        f.requestOpen.delete(id);
        f.lineBacker.set(id, backer);
        const past = f.pastBackers.get(id) ?? [];
        if (!past.some((b) => b.toLowerCase() === backer.toLowerCase())) past.push(backer);
        f.pastBackers.set(id, past);
        break;
      }
      case "LineClosed":
        f.lineBacker.delete(id);
        break;
      case "Borrowed": {
        const backer = f.lineBacker.get(id);
        if (backer) f.loanBacker.set(String(a.loanId), { agentId: id, backer });
        break;
      }
      case "Repaid": {
        const list = f.repaid.get(id) ?? [];
        list.push({ loanId: BigInt(a.loanId), block: l.blockNumber });
        f.repaid.set(id, list);
        break;
      }
    }
  }
}

/** Treasury-backed repaid loans of an agent (loan ids with their repay block). */
export function treasuryRepaidLoans(f: AdminFold, agentId: string, treasury: string) {
  const t = treasury.toLowerCase();
  return (f.repaid.get(agentId) ?? []).filter((r) => f.loanBacker.get(r.loanId.toString())?.backer.toLowerCase() === t);
}

const ADMIN_EVENTS = eventsOf(poolAbi, ["LineRequested", "LineOpened", "LineClosed", "Borrowed", "Repaid"]);

/** Per-pool scan state, kept for the page session so each refetch only fetches new blocks. */
export function createAdminScanner() {
  const f = emptyAdminFold();
  /** loanId → held >= QUALIFY_HOLD (immutable once repaid). */
  const qualified = new Map<string, boolean>();

  async function scan(client: PublicClient, pool: Address, fromBlock: bigint): Promise<void> {
    const head = await client.getBlockNumber();
    const target = head > ADMIN_SAFE_LAG ? head - ADMIN_SAFE_LAG : 0n;
    const window = CHUNK * BigInt(CONCURRENCY);
    for (;;) {
      const from = f.lastScanned === null ? fromBlock : f.lastScanned + 1n;
      if (from > target) return;
      const to = from + window - 1n < target ? from + window - 1n : target;
      const logs = await fetchLogs(client, pool, ADMIN_EVENTS, from, to);
      foldAdminLogs(f, logs);
      f.lastScanned = to;
    }
  }

  /** Qualified repayments on treasury-backed loans (held >= 3 days: repay block time - loan start). */
  async function treasuryQualified(client: PublicClient, pool: Address, agentId: string, treasury: string): Promise<number> {
    const loans = treasuryRepaidLoans(f, agentId, treasury);
    const flags = await Promise.all(
      loans.map(async (r) => {
        const k = r.loanId.toString();
        const known = qualified.get(k);
        if (known !== undefined) return known;
        const [loan, block] = await Promise.all([
          client.readContract({ address: pool, abi: poolAbi, functionName: "getLoan", args: [r.loanId] }) as Promise<{ start: bigint }>,
          client.getBlock({ blockNumber: r.block }),
        ]);
        const ok = block.timestamp - loan.start >= QUALIFY_HOLD_SEC;
        qualified.set(k, ok);
        return ok;
      }),
    );
    return flags.filter(Boolean).length;
  }

  return { fold: f, scan, treasuryQualified };
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
  paused: boolean;
  maxLoan: bigint;
  /** pool.treasury() differs from the configured treasury address. */
  treasuryMismatch: boolean;
}

const scanners = new Map<string, ReturnType<typeof createAdminScanner>>();

/**
 * Scans pool logs incrementally (only blocks after the last scan), then reads the current state of the agents
 * the queue can show (open requests and current lines), the policy inputs, pool pause/maxLoan and the treasury
 * position. All reads are plain eth_calls; the transport batches them.
 */
export async function readAdminState(
  client: PublicClient,
  cfg: { identity: Address; pool: Address; fromBlock: bigint },
  treasury: Address,
  scanner?: ReturnType<typeof createAdminScanner>,
): Promise<AdminState> {
  if (cfg.fromBlock <= 0n) throw new Error("not configured");
  const key = `${cfg.pool.toLowerCase()}:${cfg.fromBlock}`;
  const sc = scanner ?? scanners.get(key) ?? createAdminScanner();
  if (!scanner) scanners.set(key, sc);

  const read = (functionName: string, args: readonly unknown[] = [], address: Address = cfg.pool, abi: unknown = poolAbi) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<unknown>;

  await sc.scan(client, cfg.pool, cfg.fromBlock);
  const f = sc.fold;
  const t = treasury.toLowerCase();

  const ids = new Set<string>([...f.requestOpen].filter((id) => !f.lineBacker.has(id)));
  for (const [id, backer] of f.lineBacker) if (backer.toLowerCase() === t) ids.add(id);

  const states: AgentLineState[] = await Promise.all(
    [...ids].map(async (k) => {
      const id = BigInt(k);
      const [pending, line, report, uri, owner, tq] = await Promise.all([
        read("pendingRequest", [id]),
        read("lines", [id]),
        read("creditReport", [id]),
        read("tokenURI", [id], cfg.identity, identityAbi).catch(() => ""),
        read("ownerOf", [id], cfg.identity, identityAbi).catch(() => ZERO),
        sc.treasuryQualified(client, cfg.pool, k, treasury),
      ]);
      const [backer, lineAmount] = line as readonly [Address, bigint, bigint];
      const r = report as readonly unknown[];
      const u = String(uri);
      return {
        agentId: id,
        name: agentName(u.length > MAX_URI_BYTES ? "" : u, Number(id)),
        owner: owner as Address,
        pending: pending as bigint,
        backer,
        lineAmount,
        defaulted: r[7] as boolean,
        openLoanId: r[8] as bigint,
        score: r[0] as bigint,
        repaidCount: r[1] as bigint,
        qualifiedRepaid: r[2] as bigint,
        pastBackers: f.pastBackers.get(k) ?? [],
        treasuryQualified: tq,
      };
    }),
  );

  const [shares, locked, sponsorFees, paused, maxLoan, onChainTreasury] = (await Promise.all([
    read("sharesOf", [treasury]),
    read("lockedSharesOf", [treasury]),
    read("sponsorFees", [treasury]),
    read("paused"),
    read("maxLoan"),
    read("treasury"),
  ])) as [bigint, bigint, bigint, boolean, bigint, Address];
  const freeShares = shares > locked ? shares - locked : 0n;
  const [positionAssets, lockedAssets, freeAssets] = (await Promise.all([
    read("convertToAssets", [shares]),
    read("convertToAssets", [locked]),
    read("convertToAssets", [freeShares]),
  ])) as [bigint, bigint, bigint];

  return {
    ...deriveQueue([...f.requests.values()], states, treasury, maxLoan),
    treasury: { positionAssets, lockedAssets, freeAssets, freeShares, sponsorFees },
    paused,
    maxLoan,
    treasuryMismatch: onChainTreasury.toLowerCase() !== t,
  };
}
