import { createPublicClient, defineChain, http } from "viem";

export const ELYSIUM_RPC = "https://rpc.elysium.kinetiq.xyz";
export const ELYSIUM_EXPLORER = "https://elysium.kinetiq.xyz";

export const elysium = defineChain({
  id: 99901,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [ELYSIUM_RPC] } },
  blockExplorers: { default: { name: "Elysium Explorer", url: ELYSIUM_EXPLORER } },
});

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || ELYSIUM_RPC;
}

/**
 * JSON-RPC batching for reads. Elysium has no multicall3, so concurrent eth_call / eth_getLogs requests are
 * coalesced into batched HTTP requests instead.
 */
export const RPC_BATCH = { batchSize: 100 } as const;

/** `timeout` (ms) and `retryCount` override viem's defaults (10 s, 3 retries), e.g. for a latency-bounded read. */
export function makePublicClient(opts: { timeout?: number; retryCount?: number } = {}) {
  return createPublicClient({ chain: elysium, transport: http(getRpcUrl(), { batch: RPC_BATCH, ...opts }) });
}

/** Explorer page for an address. */
export function explorerAddressUrl(address: string): string {
  return `${ELYSIUM_EXPLORER}/address/${address}`;
}

/** Explorer page for a transaction. */
export function explorerTxUrl(hash: string): string {
  return `${ELYSIUM_EXPLORER}/tx/${hash}`;
}
