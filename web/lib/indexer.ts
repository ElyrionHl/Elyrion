import type { Address, Hash, PublicClient } from "viem";
import { makePublicClient } from "./chain";
import { identityAbi, poolAbi, readConfig, type ContractConfig } from "./contracts";

export type AgentStatus = "registered" | "requested" | "active" | "defaulted";

export interface AgentRow {
  id: number;
  owner: Address;
  uri: string;
  score: number;
  repaidCount: number;
  qualifiedRepaid: number;
  defaulted: boolean;
  lineAmount: bigint;
  status: AgentStatus;
  isHouse: boolean;
}

export interface RecentEvent {
  kind: "Borrowed" | "Repaid";
  agentId: number;
  block: bigint;
}

export interface Stats {
  ok: boolean;
  agents: number;
  loansRepaid: number;
  outstanding: bigint;
  treasuryDeposited: bigint;
  defaults: number;
  /** Last 20 Borrowed/Repaid events, newest first. */
  recentEvents: RecentEvent[];
}

const CHUNK = 10_000n;
const TTL_MS = 15_000;
const CONCURRENCY = 4;

const EMPTY_STATS: Stats = {
  ok: false,
  agents: 0,
  loansRepaid: 0,
  outstanding: 0n,
  treasuryDeposited: 0n,
  defaults: 0,
  recentEvents: [],
};

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

interface Snapshot {
  agents: AgentRow[];
  stats: Stats;
  loans: AgentLoan[];
}

interface Ev {
  eventName: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash?: Hash | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
}

function eventsOf(abi: readonly { type: string; name?: string }[], names: string[]) {
  return abi.filter((x) => x.type === "event" && x.name && names.includes(x.name));
}

async function fetchLogs(
  client: PublicClient,
  address: Address,
  events: unknown[],
  from: bigint,
  to: bigint,
): Promise<Ev[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += CHUNK) {
    const e = s + CHUNK - 1n;
    ranges.push([s, e > to ? to : e]);
  }
  const out: Ev[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      ranges.slice(i, i + CONCURRENCY).map(
        ([fromBlock, toBlock]) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).getLogs({ address, events, fromBlock, toBlock }) as Promise<Ev[]>,
      ),
    );
    for (const b of batch) out.push(...b);
  }
  return out;
}

const byPosition = (a: Ev, b: Ev) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

interface Draft {
  id: bigint;
  owner: Address;
  uri: string;
  pending: boolean;
  hasLine: boolean;
  defaulted: boolean;
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function createIndexer(cfg: ContractConfig, client: PublicClient) {
  let cache: { at: number; snap: Snapshot } | null = null;

  async function readReports(ids: bigint[]) {
    if (ids.length === 0) return [];
    const pool = cfg.pool as Address;
    const res = await client
      .multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({
          address: pool,
          abi: poolAbi,
          functionName: "creditReport" as const,
          args: [id] as const,
        })),
      })
      .catch(() =>
        Promise.all(
          ids.map((id) => client.readContract({ address: pool, abi: poolAbi, functionName: "creditReport", args: [id] })),
        ),
      );
    return (res as readonly (readonly unknown[])[]).map((r) => ({
      score: r[0] as bigint,
      repaidCount: r[1] as bigint,
      qualifiedRepaid: r[2] as bigint,
      lineAmount: r[4] as bigint,
      defaulted: r[7] as boolean,
    }));
  }

  async function build(): Promise<Snapshot> {
    const { identity, pool } = cfg;
    if (!identity || !pool) throw new Error("contracts not configured");

    const latest = await client.getBlockNumber();
    const from = cfg.deployBlock;
    const idEvents = eventsOf(identityAbi, ["Registered", "AgentURISet", "Transfer"]);
    const poolEvents = eventsOf(poolAbi, [
      "LineRequested",
      "LineOpened",
      "LineClosed",
      "Borrowed",
      "Repaid",
      "Defaulted",
    ]);
    const [idLogs, poolLogs] = await Promise.all([
      fetchLogs(client, identity, idEvents, from, latest),
      fetchLogs(client, pool, poolEvents, from, latest),
    ]);

    const drafts = new Map<string, Draft>();
    const draft = (id: bigint): Draft => {
      const k = id.toString();
      let d = drafts.get(k);
      if (!d) {
        d = { id, owner: ZERO, uri: "", pending: false, hasLine: false, defaulted: false };
        drafts.set(k, d);
      }
      return d;
    };

    for (const l of idLogs.sort(byPosition)) {
      if (l.eventName === "Registered") {
        const d = draft(l.args.agentId);
        d.owner = l.args.owner;
        d.uri = l.args.agentURI;
      } else if (l.eventName === "AgentURISet") {
        draft(l.args.agentId).uri = l.args.agentURI;
      } else if (l.eventName === "Transfer") {
        draft(l.args.tokenId).owner = l.args.to;
      }
    }

    let loansRepaid = 0;
    let defaults = 0;
    const flow: RecentEvent[] = [];
    const loans = new Map<string, AgentLoan>();
    const loan = (l: Ev): AgentLoan => {
      const k = String(l.args.loanId);
      let x = loans.get(k);
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
        loans.set(k, x);
      }
      return x;
    };
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
          defaults++;
          const x = loan(l);
          x.status = "defaulted";
          x.closeBlock = l.blockNumber;
          x.closeTx = l.transactionHash ?? null;
          break;
        }
        case "Repaid": {
          loansRepaid++;
          flow.push({ kind: "Repaid", agentId: Number(a.agentId), block: l.blockNumber });
          const x = loan(l);
          x.status = "repaid";
          if (x.principal === 0n) x.principal = BigInt(a.amount ?? 0);
          if (x.fee === 0n) x.fee = BigInt(a.fee ?? 0);
          x.closeBlock = l.blockNumber;
          x.closeTx = l.transactionHash ?? null;
          break;
        }
        case "Borrowed": {
          flow.push({ kind: "Borrowed", agentId: Number(a.agentId), block: l.blockNumber });
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

    const list = [...drafts.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
    const reports = await readReports(list.map((d) => d.id));
    const house = cfg.houseOwner?.toLowerCase();

    const agents: AgentRow[] = list.map((d, i) => {
      const r = reports[i];
      const defaulted = d.defaulted || r.defaulted;
      const status: AgentStatus = defaulted
        ? "defaulted"
        : d.hasLine
          ? "active"
          : d.pending
            ? "requested"
            : "registered";
      return {
        id: Number(d.id),
        owner: d.owner,
        uri: d.uri,
        score: Number(r.score),
        repaidCount: Number(r.repaidCount),
        qualifiedRepaid: Number(r.qualifiedRepaid),
        defaulted,
        lineAmount: r.lineAmount,
        status,
        isHouse: !!house && d.owner.toLowerCase() === house,
      };
    });

    const [outstanding, treasuryDeposited] = (await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "outstandingPrincipal" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "treasuryDeposited" }),
    ])) as [bigint, bigint];

    return {
      agents,
      stats: {
        ok: true,
        agents: agents.length,
        loansRepaid,
        outstanding,
        treasuryDeposited,
        defaults,
        recentEvents: flow.slice(-20).reverse(),
      },
      loans: [...loans.values()].sort((x, y) => y.loanId - x.loanId),
    };
  }

  async function snapshot(): Promise<Snapshot | null> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.snap;
    try {
      const snap = await build();
      cache = { at: Date.now(), snap };
      return snap;
    } catch {
      return null;
    }
  }

  return {
    async getStats(): Promise<Stats> {
      return (await snapshot())?.stats ?? EMPTY_STATS;
    },
    async getAgents(): Promise<{ ok: boolean; items: AgentRow[] }> {
      const s = await snapshot();
      return s ? { ok: true, items: s.agents } : { ok: false, items: [] };
    },
    async getAgent(id: number): Promise<{ ok: boolean; item: AgentRow | null }> {
      const s = await snapshot();
      return s ? { ok: true, item: s.agents.find((a) => a.id === id) ?? null } : { ok: false, item: null };
    },
    /** This agent's loans, newest first. */
    async getAgentLoans(id: number): Promise<{ ok: boolean; items: AgentLoan[] }> {
      const s = await snapshot();
      return s ? { ok: true, items: s.loans.filter((l) => l.agentId === id) } : { ok: false, items: [] };
    },
    async getAgentsByOwner(owner: string): Promise<{ ok: boolean; items: AgentRow[] }> {
      const s = await snapshot();
      return s
        ? { ok: true, items: s.agents.filter((a) => a.owner.toLowerCase() === owner.toLowerCase()) }
        : { ok: false, items: [] };
    },
  };
}

let shared: ReturnType<typeof createIndexer> | null = null;
function indexer() {
  return (shared ??= createIndexer(readConfig(), makePublicClient() as PublicClient));
}

export const getStats = () => indexer().getStats();
export const getAgents = () => indexer().getAgents();
export const getAgent = (id: number) => indexer().getAgent(id);
export const getAgentsByOwner = (owner: string) => indexer().getAgentsByOwner(owner);
export const getAgentLoans = (id: number) => indexer().getAgentLoans(id);
