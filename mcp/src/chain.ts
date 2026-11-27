import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CHAIN_ID = 99901;
export const ELYSIUM_RPC = "https://rpc.elysium.kinetiq.xyz";
export const ELYSIUM_EXPLORER = "https://elysium.kinetiq.xyz";

export interface Config {
  identity: Address;
  pool: Address;
  rpcUrl: string;
  /** Private key of the agent's own wallet; only needed by write tools. Never log or return. */
  agentKey?: string;
  /** First block to scan for event logs: the contracts' deploy block (default 0, which makes get_loans slow). */
  fromBlock: bigint;
}

export class ConfigError extends Error {}

export function makeChain(rpcUrl: string = ELYSIUM_RPC) {
  return defineChain({
    id: CHAIN_ID,
    name: "Elysium",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Elysium Explorer", url: ELYSIUM_EXPLORER } },
  });
}

export function explorerTxUrl(hash: string): string {
  return `${ELYSIUM_EXPLORER}/tx/${hash}`;
}

/** Reads and validates env. Throws ConfigError with a readable message (never echoes the key). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const identity = env.ELYRION_IDENTITY?.trim();
  const pool = env.ELYRION_POOL?.trim();
  if (!identity || !isAddress(identity)) {
    throw new ConfigError("ELYRION_IDENTITY must be set to the identity registry address (0x...).");
  }
  if (!pool || !isAddress(pool)) {
    throw new ConfigError("ELYRION_POOL must be set to the credit pool address (0x...).");
  }
  const rpcUrl = env.ELYRION_RPC_URL?.trim() || ELYSIUM_RPC;
  let fromBlock = 0n;
  const fb = env.ELYRION_FROM_BLOCK?.trim();
  if (fb) {
    if (!/^\d+$/.test(fb)) throw new ConfigError("ELYRION_FROM_BLOCK must be a block number.");
    fromBlock = BigInt(fb);
  }
  return {
    identity: identity as Address,
    pool: pool as Address,
    rpcUrl,
    agentKey: env.ELYRION_AGENT_KEY?.trim() || undefined,
    fromBlock,
  };
}

/** Normalizes a private key to 0x-prefixed hex, or returns undefined when malformed. */
export function normalizeKey(key: string): Hex | undefined {
  const k = key.startsWith("0x") || key.startsWith("0X") ? key.slice(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(k) ? (`0x${k}` as Hex) : undefined;
}

/** Clients pinned to chain id 99901. */
export function makeClients(cfg: Config) {
  const chain = makeChain(cfg.rpcUrl);
  // JSON-RPC batching (Elysium has no multicall3): get_loans' parallel getLogs ranges go out as one HTTP batch.
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl, { batch: { batchSize: 100 } }) });
  const getWallet = () => {
    if (!cfg.agentKey) {
      throw new ConfigError(
        "ELYRION_AGENT_KEY is not set. Write tools need the agent wallet's private key in the server environment.",
      );
    }
    const key = normalizeKey(cfg.agentKey);
    if (!key) throw new ConfigError("ELYRION_AGENT_KEY is not a valid 32-byte hex private key.");
    const account = privateKeyToAccount(key);
    const client = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
    return { account, client };
  };
  return { publicClient, getWallet };
}
