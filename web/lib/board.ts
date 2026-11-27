import { NAME_MAX } from "./agent-uri";
import { formatUsdc } from "./format";
import type { AgentStatus } from "./indexer";

/** A Credit Board row as the (client) table renders it. Plain JSON, no bigint. */
export interface BoardRow {
  id: number;
  name: string;
  owner: string;
  score: number;
  repaidCount: number;
  /** Formatted USDC, or "—" when there is no line. */
  line: string;
  status: AgentStatus;
  isHouse: boolean;
}

export type SortKey = "id" | "score" | "repaid";
export type SortDir = "asc" | "desc";

export const HOUSE_BADGE = "House agent · operated by Elyrion";
export const BOARD_EMPTY = "No agents yet — be the first worthy one";

export const STATUS_LABEL: Record<AgentStatus, string> = {
  registered: "Registered",
  requested: "Line requested",
  active: "Active line",
  defaulted: "Defaulted",
};

const STATUSES: AgentStatus[] = ["registered", "requested", "active", "defaulted"];

interface RawAgent {
  id: unknown;
  owner: unknown;
  name: unknown;
  score: unknown;
  repaidCount: unknown;
  lineAmount: unknown;
  status: unknown;
  isHouse: unknown;
}

/** Display name from untrusted JSON: a non-empty string, whitespace-collapsed and capped, else "Agent #id". */
export function displayName(v: unknown, id: number): string {
  if (typeof v !== "string") return `Agent #${id}`;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return `Agent #${id}`;
  const chars = [...s];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join("")}…` : s;
}

const int = (v: unknown): number | null => {
  const n = typeof v === "bigint" ? Number(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const big = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v >= 0n ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
};

/**
 * Board row from an AgentRow (server) or from /api/agents JSON (client poll,
 * where bigints arrive as decimal strings). Returns null for malformed input.
 */
export function toBoardRow(a: RawAgent): BoardRow | null {
  const id = int(a.id);
  const score = int(a.score);
  const repaid = int(a.repaidCount);
  const line = big(a.lineAmount);
  if (id === null || score === null || repaid === null || line === null) return null;
  if (typeof a.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.owner)) return null;
  const status = STATUSES.includes(a.status as AgentStatus) ? (a.status as AgentStatus) : "registered";
  return {
    id,
    name: displayName(a.name, id),
    owner: a.owner,
    score,
    repaidCount: repaid,
    line: line > 0n ? formatUsdc(line) : "—",
    status,
    isHouse: a.isHouse === true,
  };
}

export function toBoardRows(items: unknown): BoardRow[] {
  if (!Array.isArray(items)) return [];
  const out: BoardRow[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = toBoardRow(it as RawAgent);
    if (r) out.push(r);
  }
  return out;
}

/** Stable sort; ties fall back to ascending id. */
export function sortRows(rows: BoardRow[], key: SortKey, dir: SortDir): BoardRow[] {
  const val = (r: BoardRow) => (key === "id" ? r.id : key === "score" ? r.score : r.repaidCount);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => (val(a) - val(b)) * sign || a.id - b.id);
}
