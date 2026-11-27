import { ELYSIUM_EXPLORER } from "../chain";
import { EXPLORER_ATTEMPT_MS, EXPLORER_COOLDOWN_MS, MAX_TXS } from "./constants";
import type { ExplorerTokenTx, ExplorerTx, RawActivity } from "./metrics";

export class ExplorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerError";
  }
}

export type FetchDeps = { fetch?: typeof fetch; timeoutMs?: number; now?: () => number };
/** `partial` is true when a non-essential sub-request (token transfers) failed. */
export type ExplorerActivity = RawActivity & { partial: boolean };

const NO_TXS = /no transactions found/i;
const RATE_LIMIT = /rate limit/i;

/*
 * Process-wide explorer backoff (best-effort, per instance). After a 429, an in-body "rate limit" answer, or a 5xx
 * that repeats on its one retry, every explorer request fails at once for EXPLORER_COOLDOWN_MS instead of adding
 * load to an explorer that is already struggling.
 */
let cooldownUntil = 0;

/** Test hook. */
export function resetExplorerCooldown() {
  cooldownUntil = 0;
}

function coolDown(now: number) {
  cooldownUntil = Math.max(cooldownUntil, now + EXPLORER_COOLDOWN_MS);
}

type Ctx = { f: typeof fetch; timeoutMs: number; now: () => number };

/** HTTP-level failure: 5xx is retried once, 429 never (it starts the cooldown). */
class HttpStatusError extends ExplorerError {
  constructor(readonly status: number) {
    super(`explorer HTTP ${status}`);
  }
}

async function getJson(url: string, c: Ctx): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (c.now() < cooldownUntil) throw new ExplorerError("explorer cooling down after rate limiting or errors");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), c.timeoutMs);
    try {
      const res = await c.f(url, { signal: ctl.signal, cache: "no-store", headers: { accept: "application/json" } });
      if (res.status === 429) {
        coolDown(c.now());
        throw new HttpStatusError(429);
      }
      if (res.status >= 500) throw new HttpStatusError(res.status);
      if (!res.ok) throw new HttpStatusError(res.status);
      return await res.json();
    } catch (e) {
      if (e instanceof HttpStatusError) {
        if (e.status < 500) throw e; // 4xx (429 included): not retried
        if (attempt === 1) {
          coolDown(c.now()); // the 5xx repeated
          throw e;
        }
        lastErr = e;
        continue;
      }
      if (e instanceof ExplorerError) throw e;
      lastErr = e; // network error / timeout / bad JSON: one retry
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof ExplorerError) throw lastErr;
  throw new ExplorerError(`explorer request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

async function getList(url: string, c: Ctx): Promise<unknown[]> {
  const body = (await getJson(url, c)) as { status?: unknown; message?: unknown; result?: unknown } | null;
  if (!body || typeof body !== "object") throw new ExplorerError("explorer returned a non-object body");
  if (String(body.status) === "1" && Array.isArray(body.result)) return body.result;
  if (String(body.status) === "0") {
    if (Array.isArray(body.result) && body.result.length === 0) return [];
    if (NO_TXS.test(String(body.message ?? "")) || (typeof body.result === "string" && NO_TXS.test(body.result))) return [];
    if (RATE_LIMIT.test(String(body.message ?? "")) || (typeof body.result === "string" && RATE_LIMIT.test(body.result))) {
      coolDown(c.now());
    }
    throw new ExplorerError(`explorer error: ${String(body.message ?? "unknown")}`);
  }
  throw new ExplorerError("explorer returned an unexpected response");
}

const validTs = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function cleanTx(v: unknown): ExplorerTx | null {
  if (!isObj(v) || !validTs(v.timeStamp) || typeof v.from !== "string") return null;
  const block = String(v.blockNumber ?? "");
  return {
    hash: String(v.hash ?? ""),
    from: v.from,
    to: typeof v.to === "string" ? v.to : "",
    timeStamp: v.timeStamp,
    isError: String(v.isError ?? "0"),
    blockNumber: /^\d+$/.test(block) ? block : "", // anything else: firstBlock becomes null
  };
}

function cleanToken(v: unknown): ExplorerTokenTx | null {
  if (!isObj(v) || !validTs(v.timeStamp) || typeof v.contractAddress !== "string" || !v.contractAddress) return null;
  return { contractAddress: v.contractAddress, from: String(v.from ?? ""), to: String(v.to ?? ""), timeStamp: v.timeStamp };
}

const clean = <T>(list: unknown[], fn: (v: unknown) => T | null): T[] =>
  list.slice(0, MAX_TXS).map(fn).filter((x): x is T => x !== null);

export async function fetchExplorerData(address: `0x${string}`, deps: FetchDeps = {}): Promise<ExplorerActivity> {
  const c: Ctx = { f: deps.fetch ?? fetch, timeoutMs: deps.timeoutMs ?? EXPLORER_ATTEMPT_MS, now: deps.now ?? Date.now };
  const base = `${ELYSIUM_EXPLORER}/api?module=account&address=${address}&page=1`;
  const url = (action: string, offset: number, sort: string) => `${base}&action=${action}&offset=${offset}&sort=${sort}`;

  const [first, recent, tokens] = await Promise.allSettled([
    getList(url("txlist", 1, "asc"), c),
    getList(url("txlist", MAX_TXS, "desc"), c),
    getList(url("tokentx", MAX_TXS, "desc"), c),
  ]);
  if (first.status === "rejected") throw first.reason;
  if (recent.status === "rejected") throw recent.reason;

  return {
    firstTx: cleanTx(first.value[0]),
    recentTxs: clean(recent.value, cleanTx),
    tokenTxs: tokens.status === "fulfilled" ? clean(tokens.value, cleanToken) : [],
    recentFetched: Math.min(MAX_TXS, recent.value.length),
    tokenFetched: tokens.status === "fulfilled" ? Math.min(MAX_TXS, tokens.value.length) : 0,
    partial: tokens.status === "rejected",
  };
}
