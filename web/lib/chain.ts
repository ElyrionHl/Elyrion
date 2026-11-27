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

export function makePublicClient() {
  return createPublicClient({ chain: elysium, transport: http(getRpcUrl()) });
}
