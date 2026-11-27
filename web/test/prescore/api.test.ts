import { beforeEach, describe, expect, it, vi } from "vitest";

const getPreScore = vi.fn();
vi.mock("../../lib/prescore/service", async () => {
  const real = await vi.importActual<typeof import("../../lib/prescore/service")>("../../lib/prescore/service");
  return { ...real, getPreScore: (...a: unknown[]) => getPreScore(...a) };
});
vi.mock("../../lib/indexer", () => ({ getAgentsByOwner: async () => ({ ok: true, items: [] }) }));
vi.mock("../../lib/chain", async (orig) => ({
  ...(await orig<typeof import("../../lib/chain")>()),
  makePublicClient: () => ({ getCode: async () => "0x6080" }),
}));

import { GET } from "../../app/api/prescore/route";

const ADDR = "0x0729e2a4716d9f7dd17858d5d504426d228697f7";
let ipN = 0;
const req = (addr: string, ip = `10.0.0.${++ipN}`) =>
  new Request(`http://localhost/api/prescore?address=${encodeURIComponent(addr)}`, { headers: { "x-forwarded-for": ip } });

beforeEach(() => getPreScore.mockReset());

describe("api route", () => {
  it("normalises address case and whitespace", async () => {
    const real = await vi.importActual<typeof import("../../lib/prescore/service")>("../../lib/prescore/service");
    getPreScore.mockImplementation((s: string) => real.getPreScore(s));
    const a = await (await GET(req(ADDR))).json();
    const b = await (await GET(req(`  ${ADDR.toUpperCase().replace("0X", "0x")}  `))).json();
    expect(a).toEqual(b);
    expect(a.address).toBe(ADDR);
  });

  it("invalid input is 400", async () => {
    getPreScore.mockResolvedValue({ ok: false, address: "zz", reason: "invalid" });
    const res = await GET(req("zz"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("success caches 300s, no CORS header", async () => {
    getPreScore.mockResolvedValue({ ok: true, kind: "contract", address: ADDR });
    const res = await GET(req(ADDR));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("partial wallet result caches 60s, full wallet result 300s", async () => {
    const wallet = (partial: boolean) => ({ ok: true, kind: "wallet", address: ADDR, partial, computedAt: 0 });
    getPreScore.mockResolvedValueOnce(wallet(true));
    const p = await GET(req(ADDR));
    expect(p.status).toBe(200);
    expect(p.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=120");
    getPreScore.mockResolvedValueOnce(wallet(false));
    const f = await GET(req(ADDR));
    expect(f.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
  });

  it("explorer error caches 30s", async () => {
    getPreScore.mockResolvedValue({ ok: false, address: ADDR, reason: "explorer" });
    const res = await GET(req(ADDR));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30");
    expect((await res.json()).reason).toBe("explorer");
  });

  it("rate-limits per IP at 20/min", async () => {
    getPreScore.mockResolvedValue({ ok: true, kind: "contract", address: ADDR });
    const ip = "9.9.9.9";
    for (let i = 0; i < 20; i++) expect((await GET(req(ADDR, ip))).status).toBe(200);
    const res = await GET(req(ADDR, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("rate-limited");
    expect((await GET(req(ADDR, "9.9.9.10"))).status).toBe(200);
  });
});
