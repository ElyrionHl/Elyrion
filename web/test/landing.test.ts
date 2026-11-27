import { describe, expect, it } from "vitest";
import { PLEDGE_USDC, pledgeProgress } from "../lib/pledge";
import { parseLiveEvents, takeNewEvents, type LiveEvent } from "../lib/live-events";

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
