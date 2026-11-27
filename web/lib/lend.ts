import { erc20Abi, type Address, type PublicClient } from "viem";
import { poolAbi } from "./abi/ElyrionPool";
import { formatUsdc } from "./format";

/** The caps line shown above the deposit button. Fixed copy. */
export const CAPS_TEXT = "Max $1,000 per wallet · $10,000 total";
export const MSG_PAUSED = "Deposits are paused";

/** Lend-page wording for pool errors whose generic sentence is about lines. */
export const LEND_ERRORS: Record<string, string> = {
  BadAmount: "That amount is too small, or more than your unlocked shares.",
};

/** Pool-wide reads (no wallet needed). */
export interface PoolState {
  usdc: Address;
  paused: boolean;
  maxPerWallet: bigint;
  maxTotalDeposits: bigint;
  totalAssets: bigint;
  idleLiquidity: bigint;
}

/** One wallet's position. Asset values come from the pool's convertToAssets, never from raw shares. */
export interface WalletState {
  usdcBalance: bigint;
  allowance: bigint;
  depositedOf: bigint;
  shares: bigint;
  lockedShares: bigint;
  freeShares: bigint;
  /** convertToAssets(shares) */
  positionAssets: bigint;
  /** convertToAssets(lockedShares) */
  lockedAssets: bigint;
  /** convertToAssets(freeShares) */
  freeAssets: bigint;
}

export interface LendState {
  pool: PoolState;
  wallet: WalletState | null;
}

/**
 * Parses a USD amount typed by a person ("25", "25.5", "1,000.25") into USDC units (6 decimals).
 * Returns null for empty, negative, malformed or over-precise input.
 */
export function parseUsdInput(raw: string): bigint | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,12}(\.\d{0,6})?$/.test(s) && !/^\.\d{1,6}$/.test(s)) return null;
  const [whole = "", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0") || "0");
}

/** USDC units this wallet can still deposit under both caps (never negative). */
export function depositRoom(pool: PoolState, deposited: bigint): bigint {
  const wallet = pool.maxPerWallet > deposited ? pool.maxPerWallet - deposited : 0n;
  const total = pool.maxTotalDeposits > pool.totalAssets ? pool.maxTotalDeposits - pool.totalAssets : 0n;
  return wallet < total ? wallet : total;
}

/**
 * Why a deposit of `amount` cannot go through, or null when it can.
 * Mirrors the contract: paused, zero, wallet balance, per-wallet cap, total cap.
 */
export function depositBlocker(amount: bigint | null, pool: PoolState, wallet: WalletState | null): string | null {
  if (pool.paused) return MSG_PAUSED;
  if (amount === null || amount <= 0n) return "Enter an amount in USDC.";
  if (!wallet) return null;
  if (amount > wallet.usdcBalance) return `Not enough USDC in this wallet (balance ${formatUsdc(wallet.usdcBalance)}).`;
  if (wallet.depositedOf + amount > pool.maxPerWallet) {
    const room = pool.maxPerWallet > wallet.depositedOf ? pool.maxPerWallet - wallet.depositedOf : 0n;
    return `That passes the per-wallet cap. This wallet can add up to ${formatUsdc(room)}.`;
  }
  if (pool.totalAssets + amount > pool.maxTotalDeposits) {
    const room = pool.maxTotalDeposits > pool.totalAssets ? pool.maxTotalDeposits - pool.totalAssets : 0n;
    return `That passes the pool's total cap. Room left: ${formatUsdc(room)}.`;
  }
  return null;
}

/**
 * Shares to redeem for a USD withdrawal: `convertToShares(amount)` (already floored by the pool),
 * clamped to the wallet's unlocked shares. 0 means nothing can be withdrawn.
 */
export function withdrawShares(sharesForAmount: bigint, freeShares: bigint): bigint {
  if (sharesForAmount <= 0n || freeShares <= 0n) return 0n;
  return sharesForAmount < freeShares ? sharesForAmount : freeShares;
}

type Read = (functionName: string, args?: readonly unknown[], address?: Address, abi?: unknown) => Promise<unknown>;

function reader(client: PublicClient, pool: Address): Read {
  return (functionName, args = [], address = pool, abi = poolAbi) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<unknown>;
}

/** Reads the pool and (when `account` is set) the wallet's position. Individual reads; no multicall needed. */
export async function readLendState(client: PublicClient, pool: Address, account?: Address): Promise<LendState> {
  const read = reader(client, pool);
  const [usdc, paused, maxPerWallet, maxTotalDeposits, totalAssets, idleLiquidity] = (await Promise.all([
    read("usdc"),
    read("paused"),
    read("maxPerWallet"),
    read("maxTotalDeposits"),
    read("totalAssets"),
    read("idleLiquidity"),
  ])) as [Address, boolean, bigint, bigint, bigint, bigint];
  const poolState: PoolState = { usdc, paused, maxPerWallet, maxTotalDeposits, totalAssets, idleLiquidity };
  if (!account) return { pool: poolState, wallet: null };

  const [shares, lockedShares, depositedOf, usdcBalance, allowance] = (await Promise.all([
    read("sharesOf", [account]),
    read("lockedSharesOf", [account]),
    read("depositedOf", [account]),
    read("balanceOf", [account], usdc, erc20Abi),
    read("allowance", [account, pool], usdc, erc20Abi),
  ])) as [bigint, bigint, bigint, bigint, bigint];
  const freeShares = shares > lockedShares ? shares - lockedShares : 0n;
  const [positionAssets, lockedAssets, freeAssets] = (await Promise.all([
    read("convertToAssets", [shares]),
    read("convertToAssets", [lockedShares]),
    read("convertToAssets", [freeShares]),
  ])) as [bigint, bigint, bigint];
  return {
    pool: poolState,
    wallet: { usdcBalance, allowance, depositedOf, shares, lockedShares, freeShares, positionAssets, lockedAssets, freeAssets },
  };
}
