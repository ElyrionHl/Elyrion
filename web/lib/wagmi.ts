import { createConfig, http, injected } from "wagmi";
import { ELYSIUM_EXPLORER, ELYSIUM_RPC, elysium, getRpcUrl, RPC_BATCH } from "./chain";

/**
 * wagmi config: Elysium only, browser-injected wallets only (no WalletConnect).
 * Reads go through NEXT_PUBLIC_RPC_URL (falls back to the public Elysium RPC), JSON-RPC batched (no multicall3).
 */
export const wagmiConfig = createConfig({
  chains: [elysium],
  connectors: [injected()],
  transports: { [elysium.id]: http(getRpcUrl(), { batch: RPC_BATCH }) },
  ssr: true,
});

/** Passed to switchChain so a wallet without Elysium gets wallet_addEthereumChain with these exact values. */
export const ADD_ELYSIUM = {
  chainName: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: [ELYSIUM_RPC],
  blockExplorerUrls: [ELYSIUM_EXPLORER],
};

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
