"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BOARD_EMPTY,
  HOUSE_BADGE,
  sortRows,
  STATUS_LABEL,
  toBoardRows,
  type BoardRow,
  type SortDir,
  type SortKey,
} from "@/lib/board";
import { explorerAddressUrl } from "@/lib/chain";
import { utcTime } from "@/lib/live-events";
import { shortAddr } from "@/lib/format";
import type { AgentStatus } from "@/lib/indexer";

const POLL_MS = 15_000;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "repaid", label: "Repaid" },
  { key: "id", label: "#" },
];

export function StatusBadge({ status }: { status: AgentStatus }) {
  const tone =
    status === "active"
      ? "border-gold/50 text-gold"
      : status === "defaulted"
        ? "border-marble/25 text-marble/50 line-through decoration-marble/30"
        : status === "requested"
          ? "border-gold/25 text-marble/80"
          : "border-line text-mute";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] whitespace-nowrap ${tone}`}
    >
      {status === "active" ? <span aria-hidden="true" className="size-1 rounded-full bg-gold" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function HouseBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-gold/40 bg-gold/[0.06] px-2.5 py-1 font-mono text-[9.5px] tracking-[0.1em] whitespace-nowrap text-gold">
      {HOUSE_BADGE}
    </span>
  );
}

function SortHeader({
  k,
  label,
  sort,
  onSort,
  className,
}: {
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1.5 uppercase transition-colors duration-500 hover:text-gold ${active ? "text-gold" : ""}`}
      >
        {label}
        <span aria-hidden="true" className={`text-[9px] ${active ? "opacity-100" : "opacity-30"}`}>
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/**
 * The Credit Board. Server-rendered rows, client-side sort on Score / Repaid /
 * #. Refreshes from /api/agents on mount and then every 15 s while the tab is
 * visible, so new agents appear without a reload. A failed poll keeps the last
 * real rows.
 */
export function AgentTable({
  initial,
  ok,
  updatedAt = null,
  stale = false,
}: {
  initial: BoardRow[];
  ok: boolean;
  /** Unix ms of the server snapshot. */
  updatedAt?: number | null;
  /** The server served an older snapshot because its last refresh failed. */
  stale?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [live, setLive] = useState(ok);
  const [fresh, setFresh] = useState({ stale, updatedAt });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "score", dir: "desc" });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        const body = (await res.json()) as { ok?: unknown; items?: unknown; stale?: unknown; updatedAt?: unknown };
        if (alive && body.ok === true) {
          setRows(toBoardRows(body.items));
          setLive(true);
          setFresh({
            stale: body.stale === true,
            updatedAt: typeof body.updatedAt === "number" && Number.isFinite(body.updatedAt) ? body.updatedAt : null,
          });
        }
      } catch {
        // keep the last real rows
      } finally {
        if (alive) schedule();
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") timer = setTimeout(poll, POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
      else clearTimeout(timer);
    };
    // Refresh once right away: the ISR HTML can be up to one revalidate window old.
    void poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "id" ? "asc" : "desc" }));

  if (!live) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-[18px] border border-line bg-obsidian-2 p-6 text-[14px] text-marble/85">
        <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
        <span>
          <strong className="font-medium text-gold">Chain data unavailable</strong> — the board could not be read from
          Elysium right now. It retries every 15 seconds.
        </span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-[18px] border border-line bg-obsidian-2 px-6 py-16 text-center">
        <p className="display text-[30px] sm:text-[38px]">{BOARD_EMPTY}</p>
        <Link href="/register" className="btn btn-solid">
          Register an agent
        </Link>
      </div>
    );
  }

  const sorted = sortRows(rows, sort.key, sort.dir);

  return (
    <div>
      <p className="mb-5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.14em] text-marble/70 uppercase">
        <span aria-hidden="true" className={fresh.stale ? "size-1.5 rounded-full bg-mute" : "live-dot"} />
        <span>
          <span className="num text-gold">{rows.length}</span> {rows.length === 1 ? "agent" : "agents"} registered ·{" "}
          {fresh.stale && fresh.updatedAt ? `last updated ${utcTime(fresh.updatedAt)}` : "live"}
        </span>
      </p>
      {/* Mobile: sort control + stacked cards */}
      <div className="mb-4 flex items-center gap-2 md:hidden" role="group" aria-label="Sort agents">
        <span className="stat-key mr-1">Sort</span>
        {SORTS.map((s) => {
          const active = sort.key === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSort(s.key)}
              className={`rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors duration-500 ${active ? "border-gold/60 text-gold" : "border-line text-mute"}`}
            >
              {s.label}
              {active ? <span aria-hidden="true"> {sort.dir === "asc" ? "▲" : "▼"}</span> : null}
            </button>
          );
        })}
      </div>
      <ul className="grid gap-3 md:hidden">
        {sorted.map((r) => (
          <li key={r.id} className="rounded-[16px] border border-line bg-obsidian-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="num text-[11px] text-mute">#{r.id}</span>
                <Link href={`/agent/${r.id}`} className="mt-0.5 block truncate text-[16px] text-marble transition-colors duration-500 hover:text-gold">
                  {r.name}
                </Link>
              </div>
              <span className="num shrink-0 text-[26px] leading-none text-gold">{r.score}</span>
            </div>
            {r.isHouse ? (
              <div className="mt-2">
                <HouseBadge />
              </div>
            ) : null}
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Repaid</dt>
                <dd className="num mt-1 text-[13px]">{r.repaidCount}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Line</dt>
                <dd className="num mt-1 text-[13px]">{r.line}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">Owner</dt>
                <dd className="num mt-1 truncate text-[12px]">
                  <a href={explorerAddressUrl(r.owner)} target="_blank" rel="noopener noreferrer" className="text-marble/80 hover:text-gold">
                    {shortAddr(r.owner)}
                  </a>
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              <StatusBadge status={r.status} />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-[18px] border border-line bg-obsidian-2 md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Registered agents and their credit scores</caption>
          <thead>
            <tr className="border-b border-line font-mono text-[10px] tracking-[0.18em] text-mute">
              <SortHeader k="id" label="#" sort={sort} onSort={onSort} className="w-[72px] py-4 pl-6 font-normal" />
              <th scope="col" className="py-4 font-normal uppercase">
                Agent
              </th>
              <th scope="col" className="py-4 font-normal uppercase">
                Owner
              </th>
              <SortHeader k="score" label="Score" sort={sort} onSort={onSort} className="py-4 text-right font-normal" />
              <SortHeader k="repaid" label="Repaid" sort={sort} onSort={onSort} className="py-4 text-right font-normal" />
              <th scope="col" className="py-4 text-right font-normal uppercase">
                Line
              </th>
              <th scope="col" className="py-4 pr-6 pl-8 font-normal uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="board-row border-b border-line last:border-b-0">
                <td className="num py-4 pl-6 text-[12.5px] text-mute">{r.id}</td>
                <td className="max-w-[340px] py-4 pr-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Link href={`/agent/${r.id}`} className="truncate text-[15px] text-marble transition-colors duration-500 hover:text-gold">
                      {r.name}
                    </Link>
                    {r.isHouse ? <HouseBadge /> : null}
                  </div>
                </td>
                <td className="num py-4 text-[12.5px]">
                  <a href={explorerAddressUrl(r.owner)} target="_blank" rel="noopener noreferrer" className="text-marble/75 transition-colors duration-500 hover:text-gold">
                    {shortAddr(r.owner)}
                  </a>
                </td>
                <td className="num py-4 text-right text-[18px] text-gold">{r.score}</td>
                <td className="num py-4 text-right text-[13px]">{r.repaidCount}</td>
                <td className="num py-4 text-right text-[13px]">{r.line}</td>
                <td className="py-4 pr-6 pl-8">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AgentTable;
