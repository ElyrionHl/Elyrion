/** A Borrowed/Repaid event as the client sees it (block serialised as a decimal string by /api/stats). */
export interface LiveEvent {
  kind: "Borrowed" | "Repaid";
  agentId: number;
  block: string;
}

/** How many of the latest events light up on first load. */
export const FIRST_LOAD_PULSES = 3;

export function eventKey(e: LiveEvent): string {
  return `${e.kind}:${e.agentId}:${e.block}`;
}

/** Keeps only well-formed events from untrusted JSON. */
export function parseLiveEvents(raw: unknown): LiveEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: LiveEvent[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { kind, agentId, block } = r as Record<string, unknown>;
    if (kind !== "Borrowed" && kind !== "Repaid") continue;
    const id = Number(agentId);
    if (!Number.isSafeInteger(id) || id < 0) continue;
    const b = typeof block === "string" || typeof block === "number" || typeof block === "bigint" ? String(block) : "";
    if (!/^\d+$/.test(b)) continue;
    out.push({ kind, agentId: id, block: b });
  }
  return out;
}

/**
 * Events (newest first, as /api/stats returns them) that should pulse now.
 * On the first call (`seen` empty and `first` true) only the latest few pulse;
 * afterwards only events not seen before. `seen` is updated in place.
 * Returned oldest first, so pulses play in chain order.
 */
export function takeNewEvents(
  events: LiveEvent[],
  seen: Set<string>,
  first: boolean,
  firstLimit = FIRST_LOAD_PULSES,
): LiveEvent[] {
  const fresh: LiveEvent[] = [];
  for (const e of events) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(e);
  }
  const picked = first ? fresh.slice(0, firstLimit) : fresh;
  return picked.reverse();
}
