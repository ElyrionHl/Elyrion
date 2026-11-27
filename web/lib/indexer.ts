import type { Address, Hash, PublicClient } from "viem";
import { MAX_URI_BYTES, metaOf } from "./agent-uri";

export { MAX_URI_BYTES, metaOf };
import { makePublicClient } from "./chain";
import { identityAbi, poolAbi, readConfig, type ContractConfig } from "./contracts";
import { byPosition, CHUNK, CONCURRENCY, eventsOf, fetchLogs, type Ev } from "./logs";

export type AgentStatus = "registered" | "requested" | "active" | "defaulted";

export interface AgentRow {
  id: number;
  owner: Address;
  /** Display name from the registration file, or "Agent #id". Never the raw agentURI. */
  name: string;
  description?: string;
  /** https:// only (safe to render as a link). */
  endpoint?: string;
  score: number;
  repaidCount: number;
  qualifiedRepaid: number;
  defaulted: boolean;
  lineAmount: bigint;
  /** Backer of the active line; null when there is no line. */
  backer: Address | null;
  /** True when the active line is backed by the agent's current owner. */
  selfBacked: boolean;
  status: AgentStatus;
  isHouse: boolean;
}

export interface RecentEvent {
  kind: "Borrowed" | "Repaid";
  agentId: number;
  block: bigint;
}

/** Freshness of a read: `stale` when the last refresh failed and an older good snapshot is served. */
export interface Freshness {
  ok: boolean;
  stale: boolean;
  /** Unix ms of the snapshot being served; null when none. */
  updatedAt: number | null;
  /** Set when ok is false: "not configured", "syncing" or "unavailable". */
  error?: string;
}

export interface Stats extends Freshness {
  agents: number;
  loansRepaid: number;
  defaults: number;
  /** Last 20 Borrowed/Repaid events, newest first. */
  recentEvents: RecentEvent[];
  /** True when the pledge/outstanding read below succeeded (independent of the log scan). */
  pledgeOk: boolean;
  outstanding: bigint;
  /** pool.depositedOf(pool.treasury()): net USDC principal the treasury deposited. */
  treasuryDeposited: bigint;
}

export interface Pledge extends Freshness {
  /** pool.depositedOf(pool.treasury()), USDC 6 decimals. */
  deposited: bigint;
  outstanding: bigint;
}

export type LoanStatus = "open" | "repaid" | "defaulted";

/** One loan, assembled from its Borrowed and Repaid/Defaulted events. */
export interface AgentLoan {
  loanId: number;
  agentId: number;
  /** USDC, 6 decimals. */
  principal: bigint;
  /** USDC, 6 decimals. */
  fee: bigint;
  /** Unix seconds (from Borrowed); 0 when the Borrowed event was not indexed. */
  dueAt: number;
  status: LoanStatus;
  borrowBlock: bigint | null;
  borrowTx: Hash | null;
  closeBlock: bigint | null;
  closeTx: Hash | null;
}

/** Default cache TTL. */
export const TTL_MS = 15_000;
/** Blocks behind the head the scan stops at, so a lagging RPC node cannot make it skip fresh logs. */
export const SAFE_LAG = 5n;
/** Time budget for one catch-up scan; progress is kept between calls, so a cold start catches up over a few. */
export const SCAN_BUDGET_MS = 8_000;

export const MSG_NOT_CONFIGURED = "not configured";
export const MSG_SYNCING = "syncing";
export const MSG_UNAVAILABLE = "unavailable";

interface Snapshot {
  at: number;
  agents: AgentRow[];
  loans: AgentLoan[];
  counters: { loansRepaid: number; defaults: number; recentEvents: RecentEvent[] };
}

interface Draft {
  id: bigint;
  owner: Address;
  /** Owner in the Registered event (the original registrant). */
  registrant: Address;
  name?: string;
  description?: string;
  endpoint?: string;
  pending: boolean;
  hasLine: boolean;
  defaulted: boolean;
}

/** Folded chain state; only ever advanced by whole, fully fetched block windows. */
interface Folded {
  lastScanned: bigint | null;
  drafts: Map<string, Draft>;
  loans: Map<string, AgentLoan>;
  loansRepaid: number;
  defaults: number;
  flow: RecentEvent[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const ID_EVENTS = eventsOf(identityAbi, ["Registered", "AgentURISet", "Transfer"]);
const POOL_EVENTS = eventsOf(poolAbi, ["LineRequested", "LineOpened", "LineClosed", "Borrowed", "Repaid", "Defaulted"]);


export interface IndexerOptions {
  ttlMs?: number;
  budgetMs?: number;
  now?: () => number;
}

function emptyFolded(): Folded {
  return { lastScanned: null, drafts: new Map(), loans: new Map(), loansRepaid: 0, defaults: 0, flow: [] };
}

/**
 * Incremental chain indexer. Logs are fetched once: each refresh scans only the blocks after the last scanned
 * one and folds them into module state. One refresh runs at a time (callers share the in-flight promise).
 * When a refresh fails, the last good snapshot is served with `stale: true`. The pledge (treasury depositedOf
 * and outstanding principal) is read separately, so it survives a failing log scan.
 */
export function createIndexer(cfg: ContractConfig, client: PublicClient, opts: IndexerOptions = {}) {
  const ttl = opts.ttlMs ?? TTL_MS;
  const budget = opts.budgetMs ?? SCAN_BUDGET_MS;
  const now = opts.now ?? Date.now;

  const folded = emptyFolded();
  let snap: Snapshot | null = null;
  let lastAttempt = -Infinity;
  let lastError: string = MSG_UNAVAILABLE;
  let inflight: Promise<void> | null = null;

  let pledge: { at: number; deposited: bigint; outstanding: bigint } | null = null;
  let pledgeAttempt = -Infinity;
  let pledgeInflight: Promise<void> | null = null;
  let treasury: Address | null = null;

  const configured = () => !!cfg.identity && !!cfg.pool && cfg.deployBlock > 0n;

  const draft = (id: bigint): Draft => {
    const k = id.toString();
    let d = folded.drafts.get(k);
    if (!d) {
      d = { id, owner: ZERO, registrant: ZERO, pending: false, hasLine: false, defaulted: false };
      folded.drafts.set(k, d);
    }
    return d;
  };

  const loan = (l: Ev): AgentLoan => {
    const k = String(l.args.loanId);
    let x = folded.loans.get(k);
    if (!x) {
      x = {
        loanId: Number(l.args.loanId),
        agentId: Number(l.args.agentId),
        principal: 0n,
        fee: 0n,
        dueAt: 0,
        status: "open",
        borrowBlock: null,
        borrowTx: null,
        closeBlock: null,
        closeTx: null,
      };
      folded.loans.set(k, x);
    }
    return x;
  };

  function setMeta(d: Draft, uri: unknown) {
    const m = metaOf(uri);
    d.name = m.name;
    d.description = m.description;
    d.endpoint = m.endpoint;
  }

  function fold(idLogs: Ev[], poolLogs: Ev[]) {
    for (const l of idLogs.sort(byPosition)) {
      if (l.eventName === "Registered") {
        const d = draft(l.args.agentId);
        d.owner = l.args.owner;
        d.registrant = l.args.owner;
        setMeta(d, l.args.agentURI);
      } else if (l.eventName === "AgentURISet") {
        setMeta(draft(l.args.agentId), l.args.agentURI);
      } else if (l.eventName === "Transfer") {
        // A mint's Transfer (from 0) precedes Registered in the same tx; both set the same owner.
        draft(l.args.tokenId).owner = l.args.to;
      }
    }
    for (const l of poolLogs.sort(byPosition)) {
      const a = l.args;
      switch (l.eventName) {
        case "LineRequested":
          draft(a.agentId).pending = true;
          break;
        case "LineOpened": {
          const d = draft(a.agentId);
          d.pending = false;
          d.hasLine = true;
          break;
        }
        case "LineClosed": {
          const d = draft(a.agentId);
          d.pending = false;
          d.hasLine = false;
          break;
        }
        case "Defaulted": {
          draft(a.agentId).defaulted = true;
          folded.defaults++;
          const x = loan(l);
          x.status = "defaulted";
          x.closeBlock = l.blockNumber;
          x.closeTx = l.transactionHash ?? null;
          break;
        }
        case "Repaid": {
          folded.loansRepaid++;
          folded.flow.push({ kind: "Repaid", agentId: Number(a.agentId), block: l.blockNumber });
          const x = loan(l);
          x.status = "repaid";
          if (x.principal === 0n) x.principal = BigInt(a.amount ?? 0);
          if (x.fee === 0n) x.fee = BigInt(a.fee ?? 0);
          x.closeBlock = l.blockNumber;
          x.closeTx = l.transactionHash ?? null;
          break;
        }
        case "Borrowed": {
          folded.flow.push({ kind: "Borrowed", agentId: Number(a.agentId), block: l.blockNumber });
          const x = loan(l);
          x.principal = BigInt(a.amount ?? 0);
          x.fee = BigInt(a.fee ?? 0);
          x.dueAt = Number(a.dueAt ?? 0);
          x.borrowBlock = l.blockNumber;
          x.borrowTx = l.transactionHash ?? null;
          break;
        }
      }
    }
    if (folded.flow.length > 20) folded.flow.splice(0, folded.flow.length - 20);
  }

  /** Scans new blocks in windows, committing each fully fetched window. Returns true when caught up. */
  async function scan(): Promise<boolean> {
    const head = await client.getBlockNumber();
    const target = head > SAFE_LAG ? head - SAFE_LAG : 0n;
    const started = now();
    const window = CHUNK * BigInt(CONCURRENCY);
    for (;;) {
      const from = folded.lastScanned === null ? cfg.deployBlock : folded.lastScanned + 1n;
      if (from > target) return true;
      const to = from + window - 1n < target ? from + window - 1n : target;
      const [idLogs, poolLogs] = await Promise.all([
        fetchLogs(client, cfg.identity!, ID_EVENTS, from, to),
        fetchLogs(client, cfg.pool!, POOL_EVENTS, from, to),
      ]);
      fold(idLogs, poolLogs);
      folded.lastScanned = to;
      if (now() - started >= budget) return to >= target;
    }
  }

  /** creditReport for each agent; the batch transport coalesces these into JSON-RPC batches (no multicall3). */
  async function readReports(ids: bigint[]) {
    const res = await Promise.all(
      ids.map(
        (id) =>
          client.readContract({ address: cfg.pool!, abi: poolAbi, functionName: "creditReport", args: [id] }) as Promise<
            readonly unknown[]
          >,
      ),
    );
    return res.map((r) => ({
      score: r[0] as bigint,
      repaidCount: r[1] as bigint,
      qualifiedRepaid: r[2] as bigint,
      lineAmount: r[4] as bigint,
      backer: r[5] as Address,
      defaulted: r[7] as boolean,
    }));
  }

  async function refresh(): Promise<void> {
    if (!configured()) throw new Error(MSG_NOT_CONFIGURED);
    const caughtUp = await scan();
    if (!caughtUp) throw new Error(MSG_SYNCING);

    const list = [...folded.drafts.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
    const reports = await readReports(list.map((d) => d.id));
    const house = cfg.houseOwner?.toLowerCase();

    const agents: AgentRow[] = list.map((d, i) => {
      const r = reports[i];
      const defaulted = d.defaulted || r.defaulted;
      const hasBacker = !!r.backer && r.backer.toLowerCase() !== ZERO;
      const status: AgentStatus = defaulted ? "defaulted" : d.hasLine ? "active" : d.pending ? "requested" : "registered";
      const id = Number(d.id);
      return {
        id,
        owner: d.owner,
        name: d.name ?? `Agent #${id}`,
        description: d.description,
        endpoint: d.endpoint,
        score: Number(r.score),
        repaidCount: Number(r.repaidCount),
        qualifiedRepaid: Number(r.qualifiedRepaid),
        defaulted,
        lineAmount: r.lineAmount,
        backer: hasBacker ? r.backer : null,
        selfBacked: hasBacker && r.backer.toLowerCase() === d.owner.toLowerCase(),
        status,
        isHouse: !!house && d.registrant.toLowerCase() === house && d.owner.toLowerCase() === house,
      };
    });

    snap = {
      at: now(),
      agents,
      loans: [...folded.loans.values()].map((x) => ({ ...x })).sort((x, y) => y.loanId - x.loanId),
      counters: {
        loansRepaid: folded.loansRepaid,
        defaults: folded.defaults,
        recentEvents: [...folded.flow].reverse(),
      },
    };
  }

  /** Current snapshot plus freshness. Refreshes at most once per TTL; concurrent callers share one refresh. */
  async function snapshot(): Promise<{ snap: Snapshot | null; fresh: Freshness }> {
    const t = now();
    const due = !(snap && t - snap.at < ttl) && t - lastAttempt >= ttl;
    if (due && !inflight) {
      lastAttempt = t;
      inflight = refresh()
        .then(() => {
          lastError = MSG_UNAVAILABLE;
        })
        .catch((err: unknown) => {
          lastError = err instanceof Error && (err.message === MSG_NOT_CONFIGURED || err.message === MSG_SYNCING) ? err.message : MSG_UNAVAILABLE;
          // A failed refresh is retried after the TTL, not on every request.
        })
        .finally(() => {
          inflight = null;
        });
    }
    if (inflight) await inflight;
    if (!snap) return { snap: null, fresh: { ok: false, stale: false, updatedAt: null, error: lastError } };
    const stale = now() - snap.at >= ttl;
    return { snap, fresh: { ok: true, stale, updatedAt: snap.at } };
  }

  async function refreshPledge(): Promise<void> {
    if (!cfg.pool) throw new Error(MSG_NOT_CONFIGURED);
    const pool = cfg.pool;
    if (!treasury) {
      treasury = (await client.readContract({ address: pool, abi: poolAbi, functionName: "treasury" })) as Address;
    }
    const [deposited, outstanding] = (await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "depositedOf", args: [treasury] }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "outstandingPrincipal" }),
    ])) as [bigint, bigint];
    pledge = { at: now(), deposited, outstanding };
  }

  async function readPledge(): Promise<Pledge> {
    if (!cfg.pool) return { ok: false, stale: false, updatedAt: null, error: MSG_NOT_CONFIGURED, deposited: 0n, outstanding: 0n };
    const t = now();
    const due = !(pledge && t - pledge.at < ttl) && t - pledgeAttempt >= ttl;
    if (due && !pledgeInflight) {
      pledgeAttempt = t;
      pledgeInflight = refreshPledge()
        .catch(() => undefined)
        .finally(() => {
          pledgeInflight = null;
        });
    }
    if (pledgeInflight) await pledgeInflight;
    if (!pledge) return { ok: false, stale: false, updatedAt: null, error: MSG_UNAVAILABLE, deposited: 0n, outstanding: 0n };
    return {
      ok: true,
      stale: now() - pledge.at >= ttl,
      updatedAt: pledge.at,
      deposited: pledge.deposited,
      outstanding: pledge.outstanding,
    };
  }

  return {
    async getStats(): Promise<Stats> {
      const [{ snap: s, fresh }, p] = await Promise.all([snapshot(), readPledge()]);
      return {
        ...fresh,
        agents: s?.agents.length ?? 0,
        loansRepaid: s?.counters.loansRepaid ?? 0,
        defaults: s?.counters.defaults ?? 0,
        recentEvents: s?.counters.recentEvents ?? [],
        pledgeOk: p.ok,
        outstanding: p.outstanding,
        treasuryDeposited: p.deposited,
      };
    },
    getPledge: readPledge,
    async getAgents(): Promise<Freshness & { items: AgentRow[] }> {
      const { snap: s, fresh } = await snapshot();
      return { ...fresh, items: s ? s.agents : [] };
    },
    async getAgent(id: number): Promise<Freshness & { item: AgentRow | null }> {
      const { snap: s, fresh } = await snapshot();
      return { ...fresh, item: s ? (s.agents.find((a) => a.id === id) ?? null) : null };
    },
    /** This agent's loans, newest first. */
    async getAgentLoans(id: number): Promise<Freshness & { items: AgentLoan[] }> {
      const { snap: s, fresh } = await snapshot();
      return { ...fresh, items: s ? s.loans.filter((l) => l.agentId === id) : [] };
    },
    async getAgentsByOwner(owner: string): Promise<Freshness & { items: AgentRow[] }> {
      const { snap: s, fresh } = await snapshot();
      const o = owner.toLowerCase();
      return { ...fresh, items: s ? s.agents.filter((a) => a.owner.toLowerCase() === o) : [] };
    },
  };
}

/** /api/agents row: parsed name only, never the raw agentURI. */
export function publicAgent(a: AgentRow) {
  return {
    id: a.id,
    name: a.name,
    owner: a.owner,
    score: a.score,
    repaidCount: a.repaidCount,
    qualifiedRepaid: a.qualifiedRepaid,
    defaulted: a.defaulted,
    lineAmount: a.lineAmount,
    backer: a.backer,
    selfBacked: a.selfBacked,
    status: a.status,
    isHouse: a.isHouse,
  };
}

/** /api/check row. `backer` is the active line's backer (null without a line); `selfBacked` = backer is the current owner. */
export function checkView(a: AgentRow) {
  return {
    id: a.id,
    score: a.score,
    repaidCount: a.repaidCount,
    qualifiedRepaid: a.qualifiedRepaid,
    defaulted: a.defaulted,
    lineAmount: a.lineAmount,
    backer: a.backer,
    selfBacked: a.selfBacked,
  };
}

let shared: ReturnType<typeof createIndexer> | null = null;
function indexer() {
  return (shared ??= createIndexer(readConfig(), makePublicClient() as PublicClient));
}

export const getStats = () => indexer().getStats();
export const getPledge = () => indexer().getPledge();
export const getAgents = () => indexer().getAgents();
export const getAgent = (id: number) => indexer().getAgent(id);
export const getAgentsByOwner = (owner: string) => indexer().getAgentsByOwner(owner);
export const getAgentLoans = (id: number) => indexer().getAgentLoans(id);
