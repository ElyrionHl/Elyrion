import type { Address, Hash, PublicClient } from "viem";

/** Block range per getLogs call (public RPCs cap the range). */
export const CHUNK = 10_000n;
/** getLogs calls in flight at once (the batch transport sends them as one JSON-RPC batch). */
export const CONCURRENCY = 8;

/** A decoded event log, as returned by viem's getLogs with `events`. */
export interface Ev {
  eventName: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash?: Hash | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
}

/** The event entries of an ABI, by name. */
export function eventsOf(abi: readonly { type: string; name?: string }[], names: string[]) {
  return abi.filter((x) => x.type === "event" && x.name && names.includes(x.name));
}

/** Decoded logs of `events` at `address` over [from, to], fetched in CHUNK-sized ranges, CONCURRENCY at a time.
 * Throws if any range fails, so callers never fold a partial window. */
export async function fetchLogs(
  client: PublicClient,
  address: Address,
  events: unknown[],
  from: bigint,
  to: bigint,
): Promise<Ev[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += CHUNK) {
    const e = s + CHUNK - 1n;
    ranges.push([s, e > to ? to : e]);
  }
  const out: Ev[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      ranges.slice(i, i + CONCURRENCY).map(
        ([fromBlock, toBlock]) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).getLogs({ address, events, fromBlock, toBlock }) as Promise<Ev[]>,
      ),
    );
    for (const b of batch) out.push(...b);
  }
  return out;
}

/** Sorts logs by chain position (block, then log index). */
export const byPosition = (a: Ev, b: Ev) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
