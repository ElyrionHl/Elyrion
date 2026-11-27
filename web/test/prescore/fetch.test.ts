import { describe, expect, it, vi } from "vitest";
import { ExplorerError, fetchExplorerData } from "../../lib/prescore/fetch";

const ADDR = "0x0729e2a4716d9f7dd17858d5d504426d228697f7" as const;
const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ message: "OK", status: "1", result }) }) as Response;
const body = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
const tx = (ts: string, extra: object = {}) => ({ hash: "0xh", from: ADDR, to: "0x" + "1".repeat(40), timeStamp: ts, isError: "0", blockNumber: "5", ...extra });
const tok = (ts: string) => ({ contractAddress: "0x" + "2".repeat(40), from: ADDR, to: ADDR, timeStamp: ts });

function router(map: { first?: () => Response | Promise<Response>; recent?: () => Response | Promise<Response>; token?: () => Response | Promise<Response> }) {
  return vi.fn(async (url: string) => {
    if (url.includes("action=tokentx")) return map.token!();
    if (url.includes("sort=asc")) return map.first!();
    return map.recent!();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("fetchExplorerData", () => {
  it("makes 3 requests with the expected query params", async () => {
    const f = router({ first: () => ok([tx("1794300000")]), recent: () => ok([tx("1794300000")]), token: () => ok([tok("1794300000")]) });
    const r = await fetchExplorerData(ADDR, { fetch: f });
    const urls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => u.includes("action=txlist") && u.includes("offset=1&") && u.includes("sort=asc"))).toBe(true);
    expect(urls.some((u) => u.includes("action=txlist") && u.includes("offset=1000") && u.includes("sort=desc"))).toBe(true);
    expect(urls.some((u) => u.includes("action=tokentx") && u.includes("offset=1000") && u.includes("sort=desc"))).toBe(true);
    expect(urls.every((u) => u.includes(`address=${ADDR}`) && u.includes("page=1"))).toBe(true);
    expect(r.firstTx?.timeStamp).toBe("1794300000");
    expect(r.partial).toBe(false);
  });

  it("no-transactions string is empty history, other strings are errors", async () => {
    const none = () => body({ message: "No transactions found", status: "0", result: "No transactions found" });
    const r = await fetchExplorerData(ADDR, { fetch: router({ first: none, recent: none, token: none }) });
    expect(r).toEqual({ firstTx: null, recentTxs: [], tokenTxs: [], partial: false });

    const bad = () => body({ message: "NOTOK", status: "0", result: "Max rate limit reached" });
    await expect(fetchExplorerData(ADDR, { fetch: router({ first: bad, recent: bad, token: bad }) })).rejects.toBeInstanceOf(ExplorerError);
  });

  it("retries once on a network error, then throws ExplorerError", async () => {
    const f = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(fetchExplorerData(ADDR, { fetch: f })).rejects.toBeInstanceOf(ExplorerError);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6); // 3 requests x (1 + 1 retry)
  });

  it("timeout aborts and retries once", async () => {
    let n = 0;
    const f = vi.fn((_u: string, init?: RequestInit) => {
      n++;
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    }) as unknown as typeof fetch;
    await expect(fetchExplorerData(ADDR, { fetch: f, timeoutMs: 10 })).rejects.toBeInstanceOf(ExplorerError);
    expect(n).toBe(6);
  });

  it("tokentx failure is partial; txlist failure throws", async () => {
    const good = () => ok([tx("1794300000")]);
    const bad = () => body({ message: "NOTOK", status: "0", result: "oops" });
    const r = await fetchExplorerData(ADDR, { fetch: router({ first: good, recent: good, token: bad }) });
    expect(r.partial).toBe(true);
    expect(r.tokenTxs).toEqual([]);
    await expect(fetchExplorerData(ADDR, { fetch: router({ first: good, recent: bad, token: good }) })).rejects.toBeInstanceOf(ExplorerError);
  });

  it("enforces the window and sanitizes timestamps", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => tx(String(1794300000 + i)));
    const manyTok = Array.from({ length: 1200 }, (_, i) => tok(String(1794300000 + i)));
    const dirty = [tx("abc"), tx(""), tx("0"), tx("-5"), tx("1.5"), tx("1794300000")];
    const r1 = await fetchExplorerData(ADDR, { fetch: router({ first: () => ok([tx("1794300000")]), recent: () => ok(many), token: () => ok(manyTok) }) });
    expect(r1.recentTxs).toHaveLength(1000);
    expect(r1.tokenTxs).toHaveLength(1000);
    const r2 = await fetchExplorerData(ADDR, { fetch: router({ first: () => ok([tx("NaN")]), recent: () => ok(dirty), token: () => ok([tok("x"), tok("1794300000")]) }) });
    expect(r2.firstTx).toBeNull();
    expect(r2.recentTxs.map((t) => t.timeStamp)).toEqual(["1794300000"]);
    expect(r2.tokenTxs).toHaveLength(1);
  });
});
