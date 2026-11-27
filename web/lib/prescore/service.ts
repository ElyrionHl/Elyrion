import { isAddress } from "viem";
import { makePublicClient } from "../chain";
import { getAgentsByOwner } from "../indexer";
import { fetchExplorerData, type ExplorerActivity } from "./fetch";
import { deriveMetrics, type Metrics } from "./metrics";
import { scoreMetrics, type ScoreBreakdown } from "./score";
import { detectTraits, type TraitId } from "./traits";
import { buildProfile } from "./profile";
import { TRAIT_LABELS } from "./templates";

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
  | { ok: false; address: string; reason: "invalid" | "explorer" | "rate-limited" };

export type ServiceDeps = {
  fetchData?: (address: `0x${string}`) => Promise<ExplorerActivity>;
  isContract?: (address: `0x${string}`) => Promise<boolean>;
  agentsOf?: (address: string) => Promise<{ id: number; score: number }[]>;
  now?: () => number; // ms
};

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const PARTIAL_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map<string, { at: number; ttl: number; value: PreScoreResult }>();
const inflight = new Map<string, Promise<PreScoreResult>>();

export function clearPreScoreCache() {
  cache.clear();
  inflight.clear();
}

const defaultIsContract = async (a: `0x${string}`) => {
  const code = await makePublicClient().getCode({ address: a });
  return !!code && code !== "0x";
};

const defaultAgents = async (a: string) => {
  const r = await getAgentsByOwner(a);
  if (!r.ok) return [];
  return r.items.filter((x) => x.owner.toLowerCase() === a).map((x) => ({ id: x.id, score: x.score }));
};

async function compute(address: `0x${string}`, d: ServiceDeps): Promise<PreScoreResult> {
  const now = d.now ?? Date.now;
  try {
    if (await (d.isContract ?? defaultIsContract)(address)) return { ok: true, kind: "contract", address };
    const [raw, agents] = await Promise.all([
      (d.fetchData ?? ((a) => fetchExplorerData(a)))(address),
      Promise.resolve()
        .then(() => (d.agentsOf ?? defaultAgents)(address))
        .catch(() => [] as { id: number; score: number }[]),
    ]);
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
      profile: buildProfile(address, score.tier, traitIds, metrics),
      agents,
      partial: raw.partial,
      computedAt: nowMs,
    };
  } catch {
    return { ok: false, address, reason: "explorer" };
  }
}

export async function getPreScore(input: string, deps: ServiceDeps = {}): Promise<PreScoreResult> {
  const trimmed = String(input ?? "").trim();
  const key = trimmed.toLowerCase();
  if (!isAddress(key, { strict: false })) return { ok: false, address: trimmed.slice(0, 64), reason: "invalid" };
  const address = key as `0x${string}`;
  const nowMs = (deps.now ?? Date.now)();

  const hit = cache.get(key);
  if (hit && nowMs - hit.at < hit.ttl) return hit.value;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = compute(address, deps)
    .then((value) => {
      if (value.ok) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: nowMs, ttl: value.kind === "wallet" && value.partial ? PARTIAL_TTL_MS : CACHE_TTL_MS, value });
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
