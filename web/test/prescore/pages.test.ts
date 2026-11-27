import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NAV_LINKS } from "../../components/brand/Nav";
import { PRESCORE_COUNTING_RULE, PRESCORE_PARTS, PRESCORE_TIERS } from "../../lib/docs-copy";
import { cardModel } from "../../lib/prescore/card";
import { DISCLAIMER, TIER_BOUNDS } from "../../lib/prescore/constants";
import { FONT_RETRY_MS, getOgFonts, parseFontCss, resetOgFonts, type OgFont } from "../../lib/prescore/og-fonts";
import { preScoreCardResponse } from "../../lib/prescore/og-render";
import type { Metrics } from "../../lib/prescore/metrics";
import { scoreMetrics } from "../../lib/prescore/score";
import type { PreScoreResult } from "../../lib/prescore/service";
import {
  addressInputError,
  breakdownRows,
  cleanOrigin,
  displayHost,
  isFresh,
  parseAddressInput,
  pngFilename,
  readingLines,
  scoreUrl,
  shareText,
  txCountLabel,
  xIntentUrl,
} from "../../lib/prescore/view";

const ROOT = join(__dirname, "..", "..");
const src = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const ADDR = "0x0729e2a4716d9f7dd17858d5d504426d228697f7";

const metrics = (o: Partial<Metrics> = {}): Metrics => ({
  ageDays: 12,
  firstBlock: 252101,
  firstTs: 1794300000,
  txCount: 42,
  txCapped: false,
  activeDays: 5,
  distinctContracts: 3,
  distinctTokens: 14,
  usdcTransfers: 0,
  busiestDayShare: 0.5,
  ...o,
});

describe("address input", () => {
  it("is checksum-insensitive and trims", () => {
    expect(parseAddressInput(`  ${ADDR.toUpperCase().replace("0X", "0x")} `)).toBe(ADDR);
    expect(parseAddressInput("0x0729")).toBeNull();
    expect(parseAddressInput("")).toBeNull();
  });
  it("explains what is wrong, and says nothing while empty or valid", () => {
    expect(addressInputError("")).toBeNull();
    expect(addressInputError(ADDR)).toBeNull();
    expect(addressInputError("0729e2a4")).toBe("An Elysium address starts with 0x.");
    expect(addressInputError("0x07zz")).toBe("Only 0–9 and a–f may follow 0x.");
    expect(addressInputError("0x0729")).toBe("An address is 0x followed by 40 characters — this one has 4.");
  });
});

describe("reading sequence", () => {
  it("uses only the real numbers", () => {
    expect(readingLines(metrics())).toEqual(["READING 42 TRANSACTIONS", "FIRST FOOTSTEP · BLOCK 252,101", "WEIGHING 14 TOKENS"]);
  });
  it('shows "1,000+" when the fetch window is full, singulars, and no invented block', () => {
    expect(readingLines(metrics({ txCount: 1000, txCapped: true }))[0]).toBe("READING 1,000+ TRANSACTIONS");
    expect(txCountLabel({ txCount: 1000, txCapped: true })).toBe("1,000+");
    const empty = readingLines(metrics({ txCount: 1, firstBlock: null, distinctTokens: 1 }));
    expect(empty).toEqual(["READING 1 TRANSACTION", "NO FOOTSTEPS YET", "WEIGHING 1 TOKEN"]);
  });
  it("is skipped for results older than 10 s (cache)", () => {
    expect(isFresh(1_000_000, 1_005_000)).toBe(true);
    expect(isFresh(1_000_000, 1_010_001)).toBe(false);
  });
});

describe("breakdown", () => {
  it("labels points / max with the real metric behind each part", () => {
    const m = metrics({ txCount: 1000, txCapped: true });
    const rows = breakdownRows(scoreMetrics(m), m);
    expect(rows.map((r) => [r.label, r.max])).toEqual([
      ["Longevity", 300],
      ["Activity", 300],
      ["Consistency", 200],
      ["Breadth", 200],
    ]);
    expect(rows.map((r) => r.detail)).toEqual([
      "12 days since the first footstep",
      "1,000+ successful transactions sent",
      "5 active days (UTC)",
      "14 tokens · 3 contracts",
    ]);
    expect(rows.reduce((a, r) => a + r.points, 0)).toBe(scoreMetrics(m).total);
  });
});

describe("share", () => {
  it("uses the exact text template and the x.com intent", () => {
    expect(shareText(612, "Hero")).toBe("My Elysium Pre-Score is 612 — Hero. Only the worthy enter Elysium.");
    const url = scoreUrl("https://elyrion.example/", ADDR.toUpperCase().replace("0X", "0x"));
    expect(url).toBe(`https://elyrion.example/score/${ADDR}`);
    const intent = new URL(xIntentUrl(shareText(612, "Hero"), url));
    expect(intent.origin + intent.pathname).toBe("https://x.com/intent/post");
    expect(intent.searchParams.get("text")).toBe(shareText(612, "Hero"));
    expect(intent.searchParams.get("url")).toBe(url);
  });
  it("the X link works before the origin is known (server render without NEXT_PUBLIC_SITE_URL)", () => {
    const textOnly = new URL(xIntentUrl(shareText(0, "Wanderer")));
    expect(textOnly.origin + textOnly.pathname).toBe("https://x.com/intent/post");
    expect(textOnly.searchParams.get("text")).toBe(shareText(0, "Wanderer"));
    expect(textOnly.searchParams.has("url")).toBe(false);
    expect(new URL(xIntentUrl("t", "/score/0x")).searchParams.has("url")).toBe(false);
    const card = src("components", "prescore", "ShareCard.tsx");
    expect(card).toContain("const xHref = xIntentUrl(shareText(total, tier), url || undefined);");
  });
  it("names the PNG without an ellipsis and cleans origins", () => {
    expect(pngFilename(ADDR)).toBe("elyrion-prescore-0x0729-97f7.png");
    expect(cleanOrigin(" https://elyrion.example// ")).toBe("https://elyrion.example");
    expect(cleanOrigin("javascript:alert(1)")).toBe("");
    expect(displayHost("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("og card", () => {
  it("falls back to the generic card on fetch failure", () => {
    expect(cardModel({ ok: false, address: ADDR, reason: "explorer" })).toMatchObject({ variant: "generic", disclaimer: DISCLAIMER });
    expect(cardModel({ ok: true, kind: "contract", address: ADDR })).toMatchObject({ variant: "contract", total: 0 });
  });

  const png = (b: ArrayBuffer) => [...new Uint8Array(b).slice(0, 4)];
  const noFonts = async () => null;

  it("renders a PNG with the 60 s generic TTL when the explorer lookup throws", async () => {
    const res = await preScoreCardResponse(ADDR, "http://localhost:3000", {
      load: async () => {
        throw new Error("timeout");
      },
      fonts: noFonts,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(png(await res.arrayBuffer())).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  // A real TTF (bundled with next/og) registered under the brand family names: a full-quality render.
  const ttf = readFileSync(join(ROOT, "node_modules", "next", "dist", "compiled", "@vercel", "og", "Geist-Regular.ttf"));
  const data = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
  const brandFonts = async (): Promise<OgFont[]> => [
    { name: "Instrument Serif", data, weight: 400, style: "normal" },
    { name: "Instrument Serif", data, weight: 400, style: "italic" },
    { name: "JetBrains Mono", data, weight: 400, style: "normal" },
  ];
  const m = metrics();
  const wallet = (partial: boolean): PreScoreResult => ({
    ok: true,
    kind: "wallet",
    address: ADDR,
    score: scoreMetrics(m),
    metrics: m,
    traits: [{ id: "collector", label: "Collector" }],
    profile: "x",
    agents: [],
    partial,
    computedAt: 0,
  });

  it("uses the success TTL for a score and the short TTL for a partial one", async () => {
    const full = await preScoreCardResponse(ADDR, "", { load: async () => wallet(false), fonts: brandFonts });
    expect(full.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(png(await full.arrayBuffer())).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const partial = await preScoreCardResponse(ADDR, "", { load: async () => wallet(true), fonts: brandFonts });
    expect(partial.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=120");
  }, 30_000);

  it("a degraded card (no brand fonts, or a fallback render) gets the 60 s failure TTL", async () => {
    const noBrand = await preScoreCardResponse(ADDR, "", { load: async () => wallet(false), fonts: noFonts });
    expect(noBrand.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(png(await noBrand.arrayBuffer())).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Unreadable font data makes the first render throw; the fallback render still answers, short-lived.
    const broken = async (): Promise<OgFont[]> => [{ name: "JetBrains Mono", data: new ArrayBuffer(8), weight: 400, style: "normal" }];
    const fallback = await preScoreCardResponse(ADDR, "", { load: async () => wallet(false), fonts: broken });
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(png(await fallback.arrayBuffer())).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  it("remembers a font-load failure for 60 s instead of refetching on every request", async () => {
    resetOgFonts();
    let t = 1_000_000;
    const now = () => t;
    const failing = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    expect(await getOgFonts({ fetch: failing, now })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
    t += FONT_RETRY_MS - 1;
    expect(await getOgFonts({ fetch: failing, now })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1); // skipped during the window
    t += 1;
    expect(await getOgFonts({ fetch: failing, now })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2); // retried after it
    resetOgFonts();
  });

  it("reads TrueType faces from Google Fonts css", () => {
    const css = `@font-face { font-family: 'Instrument Serif'; font-style: italic; font-weight: 400; src: url(https://fonts.gstatic.com/s/a/v5/x.ttf) format('truetype'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 500; src: url(https://fonts.gstatic.com/s/b/v24/y.ttf) format('truetype'); }
@font-face { font-family: 'X'; font-style: normal; font-weight: 400; src: url(https://evil.example/z.ttf) format('truetype'); }`;
    expect(parseFontCss(css)).toEqual([
      { name: "Instrument Serif", style: "italic", weight: 400, url: "https://fonts.gstatic.com/s/a/v5/x.ttf" },
      { name: "JetBrains Mono", style: "normal", weight: 500, url: "https://fonts.gstatic.com/s/b/v24/y.ttf" },
    ]);
  });
});

describe("docs copy", () => {
  it("publishes the four formula rows exactly", () => {
    expect(PRESCORE_PARTS.map((p) => [p.part, p.max, p.formula])).toEqual([
      ["Longevity", 300, "300 × min(1, ageDays / 30)"],
      ["Activity", 300, "300 × min(1, log10(1 + txCount) / log10(1 + 500))"],
      ["Consistency", 200, "200 × min(1, activeDays / 14)"],
      ["Breadth", 200, "200 × min(1, (distinctTokens + distinctContracts) / 15)"],
    ]);
  });
  it("tiers match the scoring constants", () => {
    const fromBounds = [...TIER_BOUNDS].reverse().map((b, i, a) => [b.tier, `${b.min}–${i === a.length - 1 ? 1000 : a[i + 1].min - 1}`]);
    expect(PRESCORE_TIERS.map((t) => [...t])).toEqual(fromBounds);
  });
  it("states the counting rule", () => {
    const rule = PRESCORE_COUNTING_RULE.join(" ");
    expect(rule).toContain('isError = "0"');
    expect(rule).toContain("from = address");
    expect(rule).toContain("latest 1,000");
    expect(rule).toContain('"1,000+"');
  });
});

describe("pages and chrome", () => {
  it("nav links to /score, the hero has the Pre-Score CTA", () => {
    expect(NAV_LINKS).toContainEqual({ href: "/score", label: "Pre-Score" });
    const hero = src("components", "hero", "Hero.tsx");
    expect(hero).toMatch(/href="\/score"[\s\S]*Check your Pre-Score/);
  });

  it("docs has a Pre-Score section with the disclaimer", () => {
    const docs = src("app", "(site)", "docs", "page.tsx");
    expect(docs).toContain('["prescore", "Pre-Score"]');
    expect(docs).toContain('<H2 id="prescore">Pre-Score</H2>');
    expect(docs).toContain("{DISCLAIMER}");
  });

  it("result page, card and OG all carry the exact disclaimer", () => {
    expect(DISCLAIMER).toBe("Pre-Score · activity-based · not a credit score");
    expect(src("components", "prescore", "ScoreReveal.tsx")).toContain("{DISCLAIMER}");
    expect(src("components", "prescore", "ShareCard.tsx")).toContain("{DISCLAIMER}");
    expect(src("lib", "prescore", "og-card.tsx")).toContain("{model.disclaimer}");
    expect(src("app", "(site)", "score", "page.tsx")).toContain("{DISCLAIMER}");
  });

  it("result page: revalidate 300, invalid → notFound, contract notice, honest retry", () => {
    const page = src("app", "(site)", "score", "[address]", "page.tsx");
    expect(page).toContain("export const revalidate = 300;");
    expect(page).toContain("notFound()");
    expect(page).toContain("<ContractNotice");
    expect(page).toContain("<ScoreUnavailable");
    expect(src("components", "prescore", "ContractNotice.tsx")).toContain("Pre-Score is for <em>wallets</em>.");
    expect(src("components", "prescore", "ScoreUnavailable.tsx")).toContain("router.refresh()");
    // After a successful Retry, focus moves to the new heading.
    expect(src("components", "prescore", "ScoreUnavailable.tsx")).toContain('"prescore-result" : "prescore-contract")?.focus()');
    expect(src("components", "prescore", "ScoreReveal.tsx")).toContain('id="prescore-result" tabIndex={-1}');
    expect(src("components", "prescore", "ContractNotice.tsx")).toContain('id="prescore-contract" tabIndex={-1}');
  });

  it("badge only for registered agents, linking the agent's real credit profile", () => {
    const reveal = src("components", "prescore", "ScoreReveal.tsx");
    expect(reveal).toContain("agents.length ?");
    expect(reveal).toContain("href={`/agent/${agent.id}`}");
    expect(reveal).toContain("Registered Agent");
    expect(reveal).toContain("{agent.score}");
    expect(reveal).toMatch(/href="\/register"[\s\S]*Earn a real credit score[\s\S]*Register an agent/);
  });

  it("tilt is off for coarse pointers and reduced motion; max 8°", () => {
    const card = src("components", "prescore", "ShareCard.tsx");
    expect(card).toContain('"(pointer: coarse)"');
    expect(card).toContain("REDUCED_MOTION_QUERY");
    expect(card).toContain("const MAX_TILT = 8;");
    const css = src("app", "globals.css");
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.prescore-card \{\s*transform: none;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.prescore-card \{\s*transform: none;/);
  });

  it("copy rules hold in every Pre-Score UI file", () => {
    const files = [
      ...readdirSync(join(ROOT, "components", "prescore")).map((f) => ["components", "prescore", f]),
      ["app", "(site)", "score", "page.tsx"],
      ["app", "(site)", "score", "[address]", "page.tsx"],
      ["lib", "prescore", "og-card.tsx"],
      ["lib", "prescore", "view.ts"],
    ];
    for (const f of files) {
      const text = src(...f).replace(/unaudited/gi, "");
      expect(text, f.join("/")).not.toMatch(/\bAI\b|\bTVL\b|\bAPY\b|guaranteed|audited|official ERC-8004/i);
    }
  });
});
