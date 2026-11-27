import { isAddress, type Address } from "viem";
import { identityAbi } from "./abi/ElyrionIdentity";
import { poolAbi } from "./abi/ElyrionPool";

export { identityAbi, poolAbi };

export interface ContractConfig {
  identity?: Address;
  pool?: Address;
  deployBlock: bigint;
  houseOwner?: Address;
}

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? (v as Address) : undefined;
}

function block(v: string | undefined): bigint {
  try {
    return v ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
}

/** Reads addresses and deploy block from env at call time. Unset values leave the config empty. */
export function readConfig(): ContractConfig {
  return {
    identity: addr(process.env.NEXT_PUBLIC_IDENTITY),
    pool: addr(process.env.NEXT_PUBLIC_POOL),
    deployBlock: block(process.env.NEXT_PUBLIC_DEPLOY_BLOCK),
    houseOwner: addr(process.env.HOUSE_AGENT_OWNER),
  };
}
