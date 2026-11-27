import { isAddress } from "viem";
import { makePublicClient } from "../chain";
import { getAgentsByOwner } from "../indexer";
import { AGENTS_TIMEOUT_MS, DEADLINE_PAGE_MS, FAIL_TTL_MS, RPC_TIMEOUT_MS } from "./constants";
import { fetchExplorerData, type ExplorerActivity } from "./fetch";
import { deriveMetrics, type Metrics } from "./metrics";
import { scoreMetrics, type ScoreBreakdown } from "./score";
import { detectTraits, type TraitId } from "./traits";
import { buildProfile } from "./profile";
import { TRAIT_LABELS } from "./templates";

/**
 * Why no score was given:
 * - "explorer": the Elysium explorer did not answer in time (or is cooling down after rate limiting / errors);
 * - "rpc": the Elysium RPC did not answer `getCode`, so a wallet cannot be told from a contract;
 * - "rate-limited": /api/prescore's per-IP limit (never produced by the service itself).
 */
export type FailReason = "explorer" | "rpc" | "rate-limited";

export type PreScoreResult =
  | {
      ok: true;
      kind: "wallet";
      address: string;
      score: ScoreBreakdown;
      metrics: Metrics;
      traits: { id: TraitId; label: string }[];
      profile: string;
      agents: { id: number; score: number }[];
      partial: boolean;
      computedAt: number;
    }
  | { ok: true; kind: "contract"; address: string }
  | { ok: false; address: string; reason: "invalid" | FailReason };

export type ServiceDeps = {
  fetchData?: (address: `0x${string}`) => Promise<ExplorerActivity>;
  isContract?: (address: `0x${string}`) => Promise<boolean>;
  agentsOf?: (address: string) => Promise<{ id: number; score: number }[]>;
  now?: () => number; // ms
  /**
   * This caller's latency budget (default DEADLINE_PAGE_MS). A slower lookup resolves this call to
   * {ok:false, reason:"explorer"}; the shared lookup keeps running and fills the cache for the next request.
   */
  deadlineMs?: number;
};

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const PARTIAL_TTL_MS = 60 * 1000;
export { FAIL_TTL_MS };
const CACHE_MAX = 500;

const cache = new Map<string, { at: number; ttl: number; value: PreScoreResult }>();
const inflight = new Map<string, Promise<PreScoreResult>>();

export function clearPreScoreCache() {
  cache.clear();
  inflight.clear();
}

class RpcError extends Error {}

/**
 * Contract code, as opposed to a wallet. An EIP-7702 delegation designator (0xef0100 followed by a 20-byte
 * address: 23 bytes) sits on an externally owned account, so it counts as a wallet.
 */
export function isContractCode(code: string | undefined | null): boolean {
  const c = String(code ?? "").toLowerCase();
  if (!c || c === "0x") return false;
  if (/^0xef0100[0-9a-f]{40}$/.test(c)) return false;
  return true;
}

const defaultIsContract = async (a: `0x${string}`) =>
  isContractCode(await makePublicClient({ timeout: RPC_TIMEOUT_MS, retryCount: 0 }).getCode({ address: a }));

const defaultAgents = async (a: string) => {
  const r = await getAgentsByOwner(a);
  if (!r.ok) return [];
  return r.items.filter((x) => x.owner.toLowerCase() === a).map((x) => ({ id: x.id, score: x.score }));
};

/** Resolves to `p`, or to `fallback()` after `ms` (the timer never keeps the process alive). */
function race<T>(p: Promise<T>, ms: number, fallback: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => Promise.resolve().then(fallback).then(resolve, reject), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function compute(address: `0x${string}`, d: ServiceDeps): Promise<PreScoreResult> {
  const now = d.now ?? Date.now;
  // getCode and the explorer run side by side; agents are best-effort and short.
  const code = race(
    Promise.resolve().then(() => (d.isContract ?? defaultIsContract)(address)),
    RPC_TIMEOUT_MS,
    () => Promise.reject(new RpcError("rpc timeout")),
  ).catch((e) => Promise.reject(e instanceof RpcError ? e : new RpcError(String(e))));
  const data = Promise.resolve().then(() => (d.fetchData ?? ((a) => fetchExplorerData(a)))(address));
  const agentsP = race(
    Promise.resolve()
      .then(() => (d.agentsOf ?? defaultAgents)(address))
      .catch(() => [] as { id: number; score: number }[]),
    AGENTS_TIMEOUT_MS,
    () => [] as { id: number; score: number }[],
  );
  // Nothing may reject unobserved while another branch decides the result.
  data.catch(() => {});

  try {
    if (await code) return { ok: true, kind: "contract", address };
  } catch {
    return { ok: false, address, reason: "rpc" };
  }
  try {
    const [raw, agents] = await Promise.all([data, agentsP]);
    const nowMs = now();
    const metrics = deriveMetrics(raw, address, Math.floor(nowMs / 1000));
    const score = scoreMetrics(metrics);
    const traitIds = detectTraits(metrics);
    return {
      ok: true,
      kind: "wallet",
      address,
      score,
      metrics,
      traits: traitIds.map((id) => ({ id, label: TRAIT_LABELS[id] })),
      profile: buildProfile(address, score.tier, traitIds, metrics, { hasAgent: agents.length > 0 }),
      agents,
      partial: raw.partial,
      computedAt: nowMs,
    };
  } catch {
    return { ok: false, address, reason: "explorer" };
  }
}

function ttlFor(v: PreScoreResult): number {
  if (!v.ok) return FAIL_TTL_MS;
  return v.kind === "wallet" && v.partial ? PARTIAL_TTL_MS : CACHE_TTL_MS;
}

export async function getPreScore(input: string, deps: ServiceDeps = {}): Promise<PreScoreResult> {
  const trimmed = String(input ?? "").trim();
  const key = trimmed.toLowerCase();
  if (!isAddress(key, { strict: false })) return { ok: false, address: trimmed.slice(0, 64), reason: "invalid" };
  const address = key as `0x${string}`;
  const now = deps.now ?? Date.now;
  const nowMs = now();

  const hit = cache.get(key);
  if (hit && nowMs - hit.at < hit.ttl) return hit.value;

  let p = inflight.get(key);
  if (!p) {
    p = compute(address, deps)
      .then((value) => {
        // Failures are remembered briefly too, so a struggling explorer is not asked again on every request.
        cache.delete(key);
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now(), ttl: ttlFor(value), value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return race(p, deps.deadlineMs ?? DEADLINE_PAGE_MS, () => ({ ok: false, address, reason: "explorer" }) as const);
}
