import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreScoreCache, getPreScore, isContractCode } from "../../lib/prescore/service";
import { AGENT_CLOSERS, REGISTER_CLOSERS } from "../../lib/prescore/templates";
import { cardModel } from "../../lib/prescore/card";
import { DISCLAIMER } from "../../lib/prescore/constants";
import type { ExplorerActivity } from "../../lib/prescore/fetch";

const ADDR = "0x0729e2a4716d9f7dd17858d5d504426d228697f7";
const NOW = 1794229200 * 1000 + 5 * 86400 * 1000;
const activity: ExplorerActivity = {
  firstTx: { hash: "0x1", from: ADDR, to: "0x" + "1".repeat(40), timeStamp: "1794229300", isError: "0", blockNumber: "10" },
  recentTxs: [{ hash: "0x1", from: ADDR, to: "0x" + "1".repeat(40), timeStamp: "1794229300", isError: "0", blockNumber: "10" }],
  tokenTxs: [],
  partial: false,
};
const base = () => ({ fetchData: vi.fn(async () => activity), isContract: vi.fn(async () => false), agentsOf: vi.fn(async () => [{ id: 3, score: 40 }]), now: () => NOW });

beforeEach(() => clearPreScoreCache());

describe("getPreScore", () => {
  it("invalid input", async () => {
    const r = await getPreScore("nope", base());
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("wallet result with agents", async () => {
    const r = await getPreScore(`  ${ADDR.toUpperCase().replace("0X", "0x")}  `, base());
    expect(r.ok && r.kind === "wallet").toBe(true);
    if (r.ok && r.kind === "wallet") {
      expect(r.address).toBe(ADDR);
      expect(r.agents).toEqual([{ id: 3, score: 40 }]);
      expect(r.partial).toBe(false);
      expect(r.computedAt).toBe(NOW);
      expect(r.profile.length).toBeGreaterThan(0);
    }
  });

  it("contract address returns kind:contract", async () => {
    const d = { ...base(), isContract: vi.fn(async () => true) };
    const r = await getPreScore(ADDR, d);
    expect(r).toEqual({ ok: true, kind: "contract", address: ADDR });
  });

  it("a contract needs no explorer: a failing explorer still gives the contract notice", async () => {
    const d = { ...base(), isContract: vi.fn(async () => true), fetchData: vi.fn(async () => { throw new Error("down"); }) };
    expect(await getPreScore(ADDR, d)).toEqual({ ok: true, kind: "contract", address: ADDR });
  });

  it("getCode runs in parallel with the explorer fetch", async () => {
    const order: string[] = [];
    let releaseCode!: (v: boolean) => void;
    const d = {
      ...base(),
      isContract: vi.fn(() => {
        order.push("code:start");
        return new Promise<boolean>((r) => (releaseCode = r));
      }),
      fetchData: vi.fn(async () => {
        order.push("explorer:start");
        return activity;
      }),
    };
    const p = getPreScore(ADDR, d);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["code:start", "explorer:start"]); // the explorer started before getCode answered
    releaseCode(false);
    expect((await p).ok).toBe(true);
  });

  it('RPC failure is reason "rpc", not "explorer"', async () => {
    const d = { ...base(), isContract: vi.fn(async () => { throw new Error("rpc down"); }) };
    expect(await getPreScore(ADDR, d)).toEqual({ ok: false, address: ADDR, reason: "rpc" });
  });

  it("cache hit and in-flight dedupe make one fetch", async () => {
    const d = base();
    await Promise.all([getPreScore(ADDR, d), getPreScore(ADDR.toUpperCase().replace("0X", "0x"), d)]);
    await getPreScore(ADDR, d);
    expect(d.fetchData).toHaveBeenCalledTimes(1);
  });

  it("agents lookup failing gives agents: []", async () => {
    const d = { ...base(), agentsOf: vi.fn(async () => { throw new Error("x"); }) };
    const r = await getPreScore(ADDR, d);
    expect(r.ok && r.kind === "wallet" && r.agents).toEqual([]);
  });

  it("explorer failure gives ok:false, remembered for 15 s only", async () => {
    let t = NOW;
    const d = { ...base(), now: () => t, fetchData: vi.fn(async () => { throw new Error("down"); }) };
    expect(await getPreScore(ADDR, d)).toEqual({ ok: false, address: ADDR, reason: "explorer" });
    t = NOW + 14_000;
    expect(await getPreScore(ADDR, d)).toEqual({ ok: false, address: ADDR, reason: "explorer" });
    expect(d.fetchData).toHaveBeenCalledTimes(1); // the explorer is not asked again within 15 s
    t = NOW + 15_001;
    await getPreScore(ADDR, d);
    expect(d.fetchData).toHaveBeenCalledTimes(2);
  });

  it("an RPC failure is remembered for 15 s too", async () => {
    let t = NOW;
    const d = { ...base(), now: () => t, isContract: vi.fn(async () => { throw new Error("rpc down"); }) };
    await getPreScore(ADDR, d);
    t = NOW + 10_000;
    expect((await getPreScore(ADDR, d)).ok).toBe(false);
    expect(d.isContract).toHaveBeenCalledTimes(1);
  });

  it("an owner of a registered agent never gets a closer urging registration", async () => {
    for (let i = 0; i < 60; i++) {
      clearPreScoreCache();
      const a = `0x${i.toString(16).padStart(2, "0")}${"5".repeat(38)}`;
      const w = await getPreScore(a, base()); // base() owns agent #3
      expect(w.ok && w.kind === "wallet").toBe(true);
      if (w.ok && w.kind === "wallet") expect(REGISTER_CLOSERS.some((c) => w.profile.endsWith(c)), w.profile).toBe(false);
    }
    expect(AGENT_CLOSERS.length).toBeGreaterThanOrEqual(4);
  });

  it("partial results are cached 60s, full results 5min", async () => {
    let t = NOW;
    const mk = (partial: boolean) => ({ ...base(), fetchData: vi.fn(async () => ({ ...activity, partial })), now: () => t });
    const p = mk(true);
    await getPreScore(ADDR, p);
    t = NOW + 30_000;
    await getPreScore(ADDR, p);
    expect(p.fetchData).toHaveBeenCalledTimes(1);
    t = NOW + 61_000;
    await getPreScore(ADDR, p);
    expect(p.fetchData).toHaveBeenCalledTimes(2);
    clearPreScoreCache();
    t = NOW;
    const f = mk(false);
    await getPreScore(ADDR, f);
    t = NOW + 120_000;
    await getPreScore(ADDR, f);
    expect(f.fetchData).toHaveBeenCalledTimes(1);
  });

  it("partial flag propagates", async () => {
    const d = { ...base(), fetchData: vi.fn(async () => ({ ...activity, partial: true })) };
    const r = await getPreScore(ADDR, d);
    expect(r.ok && r.kind === "wallet" && r.partial).toBe(true);
  });
});

describe("latency budget (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function never<T>(): Promise<T> {
    return new Promise<T>(() => {});
  }

  it('a hanging explorer resolves to reason "explorer" at the 8 s page deadline', async () => {
    const d = { ...base(), now: () => Date.now(), fetchData: vi.fn(() => never<ExplorerActivity>()) };
    let settled: unknown = null;
    void getPreScore(ADDR, d).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ ok: false, address: ADDR, reason: "explorer" });
  });

  it("the OG budget (4.5 s) is shorter, and both callers share one explorer lookup", async () => {
    const d = { ...base(), now: () => Date.now(), fetchData: vi.fn(() => never<ExplorerActivity>()) };
    let og: unknown = null;
    let page: unknown = null;
    void getPreScore(ADDR, { ...d, deadlineMs: 4500 }).then((r) => (og = r));
    void getPreScore(ADDR, { ...d, deadlineMs: 8000 }).then((r) => (page = r));
    await vi.advanceTimersByTimeAsync(4500);
    expect(og).toMatchObject({ ok: false, reason: "explorer" });
    expect(page).toBeNull();
    await vi.advanceTimersByTimeAsync(3500);
    expect(page).toMatchObject({ ok: false, reason: "explorer" });
    expect(d.fetchData).toHaveBeenCalledTimes(1);
  });

  it("a lookup that finishes after a caller's deadline still fills the cache", async () => {
    let release!: (v: ExplorerActivity) => void;
    const d = { ...base(), now: () => Date.now(), fetchData: vi.fn(() => new Promise<ExplorerActivity>((r) => (release = r))) };
    const first = getPreScore(ADDR, { ...d, deadlineMs: 4500 });
    await vi.advanceTimersByTimeAsync(4500);
    expect((await first).ok).toBe(false);
    release(activity);
    await vi.advanceTimersByTimeAsync(0);
    const second = await getPreScore(ADDR, d);
    expect(second.ok && second.kind).toBe("wallet");
    expect(d.fetchData).toHaveBeenCalledTimes(1);
  });

  it('getCode that hangs gives reason "rpc" after 3 s', async () => {
    const d = { ...base(), now: () => Date.now(), isContract: vi.fn(() => never<boolean>()) };
    let settled: unknown = null;
    void getPreScore(ADDR, d).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ ok: false, address: ADDR, reason: "rpc" });
  });

  it("a slow agent lookup counts as no agents after 1.5 s", async () => {
    const d = { ...base(), now: () => Date.now(), agentsOf: vi.fn(() => never<{ id: number; score: number }[]>()) };
    let settled: unknown = null;
    void getPreScore(ADDR, d).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ ok: true, kind: "wallet", agents: [] });
  });
});

describe("isContractCode", () => {
  it("empty code is a wallet; real bytecode is a contract", () => {
    expect(isContractCode(undefined)).toBe(false);
    expect(isContractCode("0x")).toBe(false);
    expect(isContractCode("0x6080604052")).toBe(true);
  });
  it("an EIP-7702 delegation (0xef0100 + 20-byte address, 23 bytes) is a wallet", () => {
    const delegated = "0xef0100" + "ab".repeat(20);
    expect((delegated.length - 2) / 2).toBe(23);
    expect(isContractCode(delegated)).toBe(false);
    expect(isContractCode(delegated.toUpperCase().replace("0X", "0x"))).toBe(false);
    // Longer code that merely starts with the prefix is still a contract.
    expect(isContractCode(delegated + "00")).toBe(true);
    expect(isContractCode("0xef01" + "ab".repeat(21))).toBe(true);
  });
});

describe("cardModel", () => {
  it("score variant", async () => {
    const r = await getPreScore(ADDR, base());
    const c = cardModel(r);
    expect(c.variant).toBe("score");
    expect(c.shortAddress).toBe("0x0729…97f7");
    expect(c.disclaimer).toBe(DISCLAIMER);
    expect(c.traits.length).toBeLessThanOrEqual(3);
  });
  it("labels a partial result", async () => {
    const r = await getPreScore(ADDR, { ...base(), fetchData: vi.fn(async () => ({ ...activity, partial: true })) });
    expect(cardModel(r)).toMatchObject({ variant: "score", partial: true });
    clearPreScoreCache();
    expect(cardModel(await getPreScore(ADDR, base())).partial).toBe(false);
  });
  it("falls back to the generic card on failure", () => {
    const c = cardModel({ ok: false, address: ADDR, reason: "explorer" });
    expect(c).toMatchObject({ variant: "generic", total: 0, traits: [], disclaimer: DISCLAIMER });
  });
  it("contract variant has no score", () => {
    expect(cardModel({ ok: true, kind: "contract", address: ADDR }).variant).toBe("contract");
  });
  it("siteUrl trims trailing slash", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://x.test/";
    expect(cardModel({ ok: false, address: "", reason: "invalid" }).siteUrl).toBe("https://x.test");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(cardModel({ ok: false, address: "", reason: "invalid" }).siteUrl).toBe("");
  });
});
