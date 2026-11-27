import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreScoreCache, getPreScore } from "../../lib/prescore/service";
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
    expect(d.fetchData).not.toHaveBeenCalled();
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

  it("explorer failure gives ok:false and is not cached", async () => {
    const d = { ...base(), fetchData: vi.fn(async () => { throw new Error("down"); }) };
    expect(await getPreScore(ADDR, d)).toEqual({ ok: false, address: ADDR, reason: "explorer" });
    await getPreScore(ADDR, d);
    expect(d.fetchData).toHaveBeenCalledTimes(2);
  });

  it("partial flag propagates", async () => {
    const d = { ...base(), fetchData: vi.fn(async () => ({ ...activity, partial: true })) };
    const r = await getPreScore(ADDR, d);
    expect(r.ok && r.kind === "wallet" && r.partial).toBe(true);
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
