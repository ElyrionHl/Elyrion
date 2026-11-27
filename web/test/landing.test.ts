import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLEDGE_AMOUNT, PLEDGE_LINE, PLEDGE_SOURCE, PLEDGE_UNIT, PLEDGE_USDC, pledgeProgress, pledgeView } from "../lib/pledge";
import { liveLabel, parseLiveEvents, takeNewEvents, utcTime, type LiveEvent } from "../lib/live-events";

describe("pledgeProgress", () => {
  it("is closed and empty at zero", () => {
    expect(pledgeProgress(0n)).toEqual({ pct: 0, open: false });
  });
  it("fills proportionally below the pledge", () => {
    expect(pledgeProgress(250_000_000n)).toEqual({ pct: 25, open: false });
    expect(pledgeProgress(1_234_567n)).toEqual({ pct: 0.12, open: false });
    expect(pledgeProgress(PLEDGE_USDC - 1n)).toEqual({ pct: 99.99, open: false });
  });
  it("opens exactly at 1000e6 and caps the bar at 100", () => {
    expect(pledgeProgress(1_000_000_000n)).toEqual({ pct: 100, open: true });
    expect(pledgeProgress(5_000_000_000n)).toEqual({ pct: 100, open: true });
  });
  it("treats negative input as zero", () => {
    expect(pledgeProgress(-1n)).toEqual({ pct: 0, open: false });
  });
});

const ev = (kind: LiveEvent["kind"], agentId: number, block: number): LiveEvent => ({
  kind,
  agentId,
  block: String(block),
});

describe("live events", () => {
  it("parses /api/stats recentEvents and drops junk", () => {
    expect(
      parseLiveEvents([
        { kind: "Borrowed", agentId: 1, block: "12" },
        { kind: "Repaid", agentId: "2", block: 13 },
        { kind: "Defaulted", agentId: 3, block: "14" },
        { kind: "Repaid", agentId: -1, block: "15" },
        { kind: "Repaid", agentId: 4, block: "x" },
        null,
      ]),
    ).toEqual([ev("Borrowed", 1, 12), ev("Repaid", 2, 13)]);
    expect(parseLiveEvents(undefined)).toEqual([]);
  });

  it("pulses nothing when there are no events", () => {
    expect(takeNewEvents([], new Set(), true)).toEqual([]);
    expect(takeNewEvents([], new Set(), false)).toEqual([]);
  });

  it("pulses only the latest few on first load, oldest first", () => {
    const seen = new Set<string>();
    const events = [ev("Repaid", 1, 50), ev("Borrowed", 2, 40), ev("Borrowed", 1, 30), ev("Repaid", 3, 20)];
    expect(takeNewEvents(events, seen, true, 3)).toEqual([
      ev("Borrowed", 1, 30),
      ev("Borrowed", 2, 40),
      ev("Repaid", 1, 50),
    ]);
    // Everything on first load is marked seen, so a re-poll pulses nothing.
    expect(takeNewEvents(events, seen, false)).toEqual([]);
  });

  it("pulses each newly seen event exactly once", () => {
    const seen = new Set<string>();
    takeNewEvents([ev("Borrowed", 1, 10)], seen, true);
    const next = [ev("Repaid", 1, 12), ev("Borrowed", 2, 11), ev("Borrowed", 1, 10)];
    expect(takeNewEvents(next, seen, false)).toEqual([ev("Borrowed", 2, 11), ev("Repaid", 1, 12)]);
    expect(takeNewEvents(next, seen, false)).toEqual([]);
  });
});

describe("pledge gate (depositedOf)", () => {
  it("keeps the fixed pledge copy", () => {
    expect(`${PLEDGE_AMOUNT} ${PLEDGE_UNIT} · ${PLEDGE_LINE}`).toBe("$1,000 USDC · pledged by the Elyrion team to the treasury");
    expect(PLEDGE_SOURCE).toMatch(/depositedOf/);
    expect(PLEDGE_SOURCE).not.toMatch(/value of the treasury wallet's pool shares/);
  });

  it("shows the live deposited amount and opens exactly at 1000e6", () => {
    expect(pledgeView(0n, true)).toMatchObject({ isOpen: false, amount: "$0.00", progressText: "Deposited on-chain: $0.00 / $1,000", pctText: "0.00%" });
    expect(pledgeView(999_999_999n, true)).toMatchObject({ isOpen: false, progressText: "Deposited on-chain: $999.99 / $1,000" });
    expect(pledgeView(1_000_000_000n, true)).toMatchObject({
      isOpen: true,
      pct: 100,
      progressText: "Deposited on-chain: $1,000.00 / $1,000",
      statusText: "The Gate is open",
    });
  });

  it("never shows a number or opens when the chain is unreadable", () => {
    expect(pledgeView(5_000_000_000n, false)).toMatchObject({
      isOpen: false,
      amount: "—",
      pctText: "—",
      dollars: undefined,
      progressText: "Deposited on-chain: — / $1,000",
      statusText: "Live chain data is unavailable right now.",
    });
  });

  it("renders $1,000 USDC with a real space and uses the view helper and getPledge", () => {
    const src = readFileSync(join(__dirname, "..", "components", "PledgeGate.tsx"), "utf8");
    expect(src).toMatch(/\{PLEDGE_AMOUNT\}\s*<\/span>\{" "\}\s*<span[^>]*>\{PLEDGE_UNIT\}/);
    expect(src).toContain("pledgeView(deposited, ok)");
    const page = readFileSync(join(__dirname, "..", "app", "(site)", "page.tsx"), "utf8");
    expect(page).toContain("deposited={pledge.deposited}");
  });
});

describe("hero live label", () => {
  const t = Date.UTC(2026, 10, 27, 9, 5);
  it("says Live only while fresh", () => {
    expect(liveLabel({ ok: true, stale: false, failures: 0, updatedAt: t })).toEqual({ text: "Live · Elysium", live: true });
    expect(liveLabel({ ok: true, stale: false, failures: 1, updatedAt: t })).toEqual({ text: "Live · Elysium", live: true });
  });
  it("switches to Last updated after 2 failed polls or a stale snapshot", () => {
    expect(liveLabel({ ok: true, stale: false, failures: 2, updatedAt: t })).toEqual({ text: "Last updated 09:05 UTC", live: false });
    expect(liveLabel({ ok: true, stale: true, failures: 0, updatedAt: t })).toEqual({ text: "Last updated 09:05 UTC", live: false });
    expect(utcTime(t)).toBe("09:05 UTC");
  });
  it("shows unavailable when nothing was ever read", () => {
    expect(liveLabel({ ok: false, stale: false, failures: 3, updatedAt: null })).toEqual({ text: "Chain data unavailable", live: false });
  });
});
