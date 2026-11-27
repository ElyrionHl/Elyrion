import { ELYSIUM_EXPLORER } from "../chain";
import { MAX_TXS } from "./constants";
import type { ExplorerTokenTx, ExplorerTx, RawActivity } from "./metrics";

export class ExplorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerError";
  }
}

export type FetchDeps = { fetch?: typeof fetch; timeoutMs?: number };
/** `partial` is true when a non-essential sub-request (token transfers) failed. */
export type ExplorerActivity = RawActivity & { partial: boolean };

const TIMEOUT_MS = 8000;
const NO_TXS = /no transactions found/i;

async function getJson(url: string, f: typeof fetch, timeoutMs: number): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, { signal: ctl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new ExplorerError(`explorer HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof ExplorerError) throw e; // HTTP-level failure: not retried
      lastErr = e; // network error / timeout / bad JSON: one retry
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ExplorerError(`explorer request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

async function getList(url: string, f: typeof fetch, timeoutMs: number): Promise<unknown[]> {
  const body = (await getJson(url, f, timeoutMs)) as { status?: unknown; message?: unknown; result?: unknown } | null;
  if (!body || typeof body !== "object") throw new ExplorerError("explorer returned a non-object body");
  if (String(body.status) === "1" && Array.isArray(body.result)) return body.result;
  if (String(body.status) === "0") {
    if (Array.isArray(body.result) && body.result.length === 0) return [];
    if (NO_TXS.test(String(body.message ?? "")) || (typeof body.result === "string" && NO_TXS.test(body.result))) return [];
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
  return {
    hash: String(v.hash ?? ""),
    from: v.from,
    to: typeof v.to === "string" ? v.to : "",
    timeStamp: v.timeStamp,
    isError: String(v.isError ?? "0"),
    blockNumber: String(v.blockNumber ?? ""),
  };
}

function cleanToken(v: unknown): ExplorerTokenTx | null {
  if (!isObj(v) || !validTs(v.timeStamp) || typeof v.contractAddress !== "string" || !v.contractAddress) return null;
  return { contractAddress: v.contractAddress, from: String(v.from ?? ""), to: String(v.to ?? ""), timeStamp: v.timeStamp };
}

const clean = <T>(list: unknown[], fn: (v: unknown) => T | null): T[] =>
  list.slice(0, MAX_TXS).map(fn).filter((x): x is T => x !== null);

export async function fetchExplorerData(address: `0x${string}`, deps: FetchDeps = {}): Promise<ExplorerActivity> {
  const f = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const base = `${ELYSIUM_EXPLORER}/api?module=account&address=${address}&page=1`;
  const url = (action: string, offset: number, sort: string) => `${base}&action=${action}&offset=${offset}&sort=${sort}`;

  const [first, recent, tokens] = await Promise.allSettled([
    getList(url("txlist", 1, "asc"), f, timeoutMs),
    getList(url("txlist", MAX_TXS, "desc"), f, timeoutMs),
    getList(url("tokentx", MAX_TXS, "desc"), f, timeoutMs),
  ]);
  if (first.status === "rejected") throw first.reason;
  if (recent.status === "rejected") throw recent.reason;

  return {
    firstTx: cleanTx(first.value[0]),
    recentTxs: clean(recent.value, cleanTx),
    tokenTxs: tokens.status === "fulfilled" ? clean(tokens.value, cleanToken) : [],
    partial: tokens.status === "rejected",
  };
}
