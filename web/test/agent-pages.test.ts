import { describe, expect, it } from "vitest";
import {
  agentName,
  buildAgentURI,
  DATA_URI_PREFIX,
  parseAgentMeta,
  REGISTRATION_TYPE,
  validateRegistration,
} from "../lib/agent-uri";
import { BOARD_EMPTY, HOUSE_BADGE, sortRows, toBoardRow, toBoardRows } from "../lib/board";
import { humanizeError, MSG_NO_WALLET, MSG_REJECTED, MSG_WRONG_CHAIN } from "../lib/tx-errors";

const OWNER = "0x00000000000000000000000000000000000000c3";
const decode = (uri: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.slice(DATA_URI_PREFIX.length)), (c) => c.charCodeAt(0))));

describe("agentURI", () => {
  it("builds a base64 data URI with the ERC-8004 registration type", () => {
    const uri = buildAgentURI({ name: "  Atlas ", description: "Routes swaps", endpoint: "https://atlas.example/mcp" });
    expect(uri.startsWith(DATA_URI_PREFIX)).toBe(true);
    expect(decode(uri)).toEqual({
      name: "Atlas",
      description: "Routes swaps",
      endpoint: "https://atlas.example/mcp",
      type: REGISTRATION_TYPE,
    });
  });

  it("is UTF-8 safe (emoji, accents) and round-trips through parseAgentMeta", () => {
    const uri = buildAgentURI({ name: "Hélios ☀️", description: "Ünïcode — ok 🚀", endpoint: "" });
    expect(decode(uri).name).toBe("Hélios ☀️");
    expect(parseAgentMeta(uri)).toEqual({ name: "Hélios ☀️", description: "Ünïcode — ok 🚀", endpoint: undefined });
    expect(agentName(uri, 7)).toBe("Hélios ☀️");
  });

  it("validates name 2–64, description ≤ 280, endpoint https or empty", () => {
    const ok = { name: "Ab", description: "", endpoint: "" };
    expect(validateRegistration(ok)).toEqual({});
    expect(validateRegistration({ ...ok, name: " a " }).name).toBeDefined();
    expect(validateRegistration({ ...ok, name: "x".repeat(64) }).name).toBeUndefined();
    expect(validateRegistration({ ...ok, name: "x".repeat(65) }).name).toBeDefined();
    expect(validateRegistration({ ...ok, description: "d".repeat(280) }).description).toBeUndefined();
    expect(validateRegistration({ ...ok, description: "d".repeat(281) }).description).toBeDefined();
    expect(validateRegistration({ ...ok, endpoint: "http://insecure.example" }).endpoint).toBeDefined();
    expect(validateRegistration({ ...ok, endpoint: "javascript:alert(1)" }).endpoint).toBeDefined();
    expect(validateRegistration({ ...ok, endpoint: "not a url" }).endpoint).toBeDefined();
    expect(validateRegistration({ ...ok, endpoint: "https://a.example/x" }).endpoint).toBeUndefined();
  });

  it("falls back to Agent #id for non-data URIs and malformed JSON, never throws", () => {
    expect(agentName("https://example.com/agent.json", 3)).toBe("Agent #3");
    expect(agentName("ipfs://abc", 4)).toBe("Agent #4");
    expect(agentName(`${DATA_URI_PREFIX}!!!not-base64`, 5)).toBe("Agent #5");
    expect(agentName(`${DATA_URI_PREFIX}${btoa("[1,2]")}`, 6)).toBe("Agent #6");
    expect(agentName(`${DATA_URI_PREFIX}${btoa('{"name":42}')}`, 8)).toBe("Agent #8");
    expect(agentName("", 9)).toBe("Agent #9");
  });

  it("decodes percent-encoded JSON and drops non-https endpoints", () => {
    const uri = `data:application/json,${encodeURIComponent('{"name":"Plain","endpoint":"javascript:alert(1)"}')}`;
    expect(parseAgentMeta(uri)).toEqual({ name: "Plain", description: undefined, endpoint: undefined });
  });

  it("caps an over-long on-chain name", () => {
    const uri = `${DATA_URI_PREFIX}${btoa(JSON.stringify({ name: "n".repeat(500) }))}`;
    expect([...agentName(uri, 1)].length).toBe(64);
  });
});

describe("board rows", () => {
  const raw = (o: Record<string, unknown> = {}) => ({
    id: 1, owner: OWNER, uri: "", score: 0, repaidCount: 0, lineAmount: 0n, status: "registered", isHouse: false, ...o,
  });

  it("formats line, names and passes isHouse through exactly", () => {
    const r = toBoardRow(raw({ id: 2, lineAmount: 5_000_000n, isHouse: true }))!;
    expect(r).toMatchObject({ id: 2, name: "Agent #2", line: "$5.00", isHouse: true });
    expect(toBoardRow(raw({ isHouse: "true" }))!.isHouse).toBe(false);
    expect(toBoardRow(raw())!.line).toBe("—");
  });

  it("accepts /api/agents JSON (bigints as strings) and drops malformed rows", () => {
    const rows = toBoardRows([
      raw({ id: 1, lineAmount: "50000000" }),
      raw({ id: "x" }),
      raw({ owner: "nope" }),
      null,
      raw({ id: 3, score: -1 }),
    ]);
    expect(rows.map((r) => [r.id, r.line])).toEqual([[1, "$50.00"]]);
    expect(toBoardRows({ not: "an array" })).toEqual([]);
  });

  it("sorts by score / repaid / id with id as tie-break", () => {
    const rows = toBoardRows([
      raw({ id: 1, score: 300, repaidCount: 2 }),
      raw({ id: 2, score: 800, repaidCount: 1 }),
      raw({ id: 3, score: 300, repaidCount: 5 }),
    ]);
    expect(sortRows(rows, "score", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRows(rows, "repaid", "desc").map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(rows, "id", "desc").map((r) => r.id)).toEqual([3, 2, 1]);
    expect(sortRows(rows, "score", "asc").map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("keeps the exact fixed copy", () => {
    expect(HOUSE_BADGE).toBe("House agent · operated by Elyrion");
    expect(BOARD_EMPTY).toBe("No agents yet — be the first worthy one");
  });
});

describe("humanizeError", () => {
  it("maps rejection, missing wallet, wrong chain and contract reverts", () => {
    expect(humanizeError({ name: "UserRejectedRequestError", message: "User rejected the request." })).toBe(MSG_REJECTED);
    expect(humanizeError({ name: "ContractFunctionExecutionError", cause: { code: 4001, message: "denied" } })).toBe(MSG_REJECTED);
    expect(humanizeError({ name: "ProviderNotFoundError", message: "Provider not found." })).toBe(MSG_NO_WALLET);
    expect(humanizeError({ name: "ChainMismatchError", message: "x" })).toBe(MSG_WRONG_CHAIN);
    expect(
      humanizeError({ name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", data: { errorName: "NotAgentOwner" } } }),
    ).toMatch(/owner/i);
    expect(humanizeError({ shortMessage: 'The contract function "requestLine" reverted with custom error LineActive()' })).toMatch(/already has an open line/);
  });

  it("falls back to the short message, never throws on junk", () => {
    expect(humanizeError({ shortMessage: "RPC timeout" })).toBe("Transaction failed: RPC timeout");
    expect(humanizeError(null)).toBe("Something went wrong. Please try again.");
    expect(humanizeError("boom")).toBe("Something went wrong. Please try again.");
  });
});

describe("docs copy and copy rules", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const docs = await import("../lib/docs-copy");

  it("score rows, default rule, backer note and credit are verbatim", () => {
    expect(docs.SCORE_ROWS).toEqual([
      "Dollar-days — 1 point per $1-day held, max 400",
      "Qualified loans — 25 points per repaid loan held ≥ 3 days, max 250",
      "Backing — 3 points per $1 of active line, max 150",
      "Age — 5 points per day since first repayment, max 200",
    ]);
    expect(docs.DEFAULT_RULE).toBe("A default sets the score to 0 permanently.");
    expect(docs.PRIORS_CREDIT).toBe("Score design adapted from Priors (MIT).");
    expect(docs.BACKER_NOTE).toBe(
      "A line follows the agent NFT: if the agent is transferred, the new owner can borrow against it until the backer closes the line.",
    );
    expect(docs.MCP_TOOLS).toEqual(["register_agent", "request_line", "check_score", "get_line", "get_loans", "borrow", "repay"]);
  });

  it("site sources never use forbidden phrases", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, "..", "app"));
    walk(join(__dirname, "..", "components"));
    walk(join(__dirname, "..", "lib"));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const bad of [/\bTVL\b/, /in treasury/i, /\bAPY\b/, /yield guaranteed/i, /official ERC-8004/i, /(?<!un)audited/i]) {
        expect(`${f}: ${bad.test(text)}`).toBe(`${f}: false`);
      }
    }
  });
});
