"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { erc20Abi, parseEventLogs, type Address, type Hash, type PublicClient } from "viem";
import { useConfig, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { RiskNote } from "@/components/brand/RiskNote";
import { useElysiumWallet } from "@/components/ConnectButton";
import { ErrorNote, Note, StatCell, TxLink } from "@/components/TxUi";
import { poolAbi } from "@/lib/abi/ElyrionPool";
import { elysium } from "@/lib/chain";
import { formatUsdc, formatUsdcExact } from "@/lib/format";
import {
  CAPS_TEXT,
  depositBlocker,
  depositRoom,
  LEND_ERRORS,
  MSG_PAUSED,
  parseUsdInput,
  readLendState,
  withdrawShares,
  type LendState,
} from "@/lib/lend";
import { humanizeError, MSG_NOT_CONFIGURED, MSG_WRONG_CHAIN } from "@/lib/tx-errors";

type Phase = "idle" | "approve-sign" | "approve-confirm" | "deposit-sign" | "deposit-confirm" | "withdraw-sign" | "withdraw-confirm";

interface Done {
  kind: "deposit" | "withdraw";
  assets: bigint;
}

const INPUT =
  "num w-full min-w-0 rounded-[12px] border border-line bg-obsidian py-3 pr-4 pl-8 text-[16px] text-marble placeholder:text-mute/60 transition-colors duration-500 outline-none hover:border-gold/30 focus:border-gold/60 aria-[invalid=true]:border-gold/70 disabled:opacity-60";

const unitsToInput = (v: bigint) => {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};

function AmountInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <span aria-hidden="true" className="num pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[16px] text-mute">
        $
      </span>
      <input
        id={id}
        className={INPUT}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}

/**
 * Lend: wallet USDC, pool position (via convertToAssets), deposit (approve exactly, then deposit)
 * and withdraw (USD amount → convertToShares, clamped to unlocked shares; or all unlocked).
 */
export function LendPanel({ pool }: { pool?: Address }) {
  const uid = useId();
  const config = useConfig();
  const client = usePublicClient({ chainId: elysium.id }) as PublicClient | undefined;
  const wallet = useElysiumWallet();
  const write = useWriteContract();

  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<{ approve?: Hash; deposit?: Hash; withdraw?: Hash }>({});
  const [done, setDone] = useState<Done | null>(null);
  /** Which card shows the latest error / result / tx links. */
  const [scope, setScope] = useState<"deposit" | "withdraw">("deposit");

  const configured = !!pool;
  const account = wallet.connected && wallet.onElysium ? wallet.address : undefined;

  const q = useQuery({
    queryKey: ["lend", pool, account],
    enabled: configured && !!client,
    queryFn: () => readLendState(client!, pool!, account),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const st: LendState | undefined = q.data;

  const busy = phase !== "idle";
  const depositAmount = parseUsdInput(depositInput);
  const blocker = st ? depositBlocker(depositAmount, st.pool, st.wallet) : null;
  const paused = !!st?.pool.paused;
  const shownError = error ?? wallet.error;

  function guard(): boolean {
    setError(null);
    setDone(null);
    wallet.clearError();
    if (!configured || !client) {
      setError(MSG_NOT_CONFIGURED);
      return false;
    }
    if (!wallet.connected) {
      void wallet.connectWallet();
      return false;
    }
    if (!wallet.onElysium) {
      setError(MSG_WRONG_CHAIN);
      return false;
    }
    return true;
  }

  async function fresh(): Promise<LendState | null> {
    const r = await q.refetch();
    return r.data ?? null;
  }

  async function confirm(hash: Hash, what: string) {
    const receipt = await waitForTransactionReceipt(config, { hash, chainId: elysium.id });
    if (receipt.status !== "success") throw new Error(`The ${what} transaction reverted.`);
    return receipt;
  }

  async function onDeposit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setScope("deposit");
    if (!guard()) return;
    const amount = parseUsdInput(depositInput);
    try {
      const s = await fresh();
      if (!s?.wallet) throw new Error("Could not read your position from Elysium. Try again.");
      const why = depositBlocker(amount, s.pool, s.wallet);
      if (why || amount === null) {
        setError(why ?? "Enter an amount in USDC.");
        return;
      }
      setHashes({});
      if (s.wallet.allowance < amount) {
        // Exactly this amount; never an unlimited approval.
        setPhase("approve-sign");
        const approve = await write.mutateAsync({
          address: s.pool.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [pool!, amount],
          chainId: elysium.id,
        });
        setHashes({ approve });
        setPhase("approve-confirm");
        await confirm(approve, "approval");
      }
      setPhase("deposit-sign");
      const deposit = await write.mutateAsync({
        address: pool!,
        abi: poolAbi,
        functionName: "deposit",
        args: [amount],
        chainId: elysium.id,
      });
      setHashes((h) => ({ ...h, deposit }));
      setPhase("deposit-confirm");
      await confirm(deposit, "deposit");
      setDone({ kind: "deposit", assets: amount });
      setDepositInput("");
    } catch (err) {
      setError(humanizeError(err, LEND_ERRORS));
    } finally {
      setPhase("idle");
      void q.refetch();
    }
  }

  async function onWithdraw(all: boolean) {
    if (busy) return;
    setScope("withdraw");
    if (!guard()) return;
    try {
      const s = await fresh();
      if (!s?.wallet) throw new Error("Could not read your position from Elysium. Try again.");
      let shares: bigint;
      if (all) {
        shares = s.wallet.freeShares;
      } else {
        const amount = parseUsdInput(withdrawInput);
        if (amount === null || amount <= 0n) {
          setError("Enter an amount in USDC to withdraw.");
          return;
        }
        const forAmount = (await client!.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "convertToShares",
          args: [amount],
        })) as bigint;
        shares = withdrawShares(forAmount, s.wallet.freeShares);
      }
      if (shares <= 0n) {
        setError(s.wallet.freeShares > 0n ? "That amount is too small to withdraw." : "Nothing unlocked to withdraw.");
        return;
      }
      setHashes({});
      setPhase("withdraw-sign");
      const hash = await write.mutateAsync({
        address: pool!,
        abi: poolAbi,
        functionName: "withdraw",
        args: [shares],
        chainId: elysium.id,
      });
      setHashes({ withdraw: hash });
      setPhase("withdraw-confirm");
      const receipt = await confirm(hash, "withdrawal");
      const ev = parseEventLogs({ abi: poolAbi, eventName: "Withdrawn", logs: receipt.logs }).find(
        (l) => l.address.toLowerCase() === pool!.toLowerCase(),
      );
      setDone({ kind: "withdraw", assets: ev ? ev.args.assets : 0n });
      setWithdrawInput("");
    } catch (err) {
      setError(humanizeError(err, LEND_ERRORS));
    } finally {
      setPhase("idle");
      void q.refetch();
    }
  }

  const w = st?.wallet ?? null;
  const room = st && w ? depositRoom(st.pool, w.depositedOf) : null;
  const maxDeposit = w && room !== null ? (w.usdcBalance < room ? w.usdcBalance : room) : null;
  const lentOut = st && w && w.freeAssets > st.pool.idleLiquidity;

  const depositLabel = !wallet.connected
    ? wallet.connecting
      ? "Connecting…"
      : "Connect wallet"
    : !wallet.onElysium
      ? wallet.switching
        ? "Switching…"
        : "Switch to Elysium"
      : phase === "approve-sign"
        ? "Approve in your wallet… (1 of 2)"
        : phase === "approve-confirm"
          ? "Waiting for approval…"
          : phase === "deposit-sign"
            ? "Confirm deposit in your wallet…"
            : phase === "deposit-confirm"
              ? "Waiting for confirmation…"
              : paused
                ? MSG_PAUSED
                : depositAmount && depositAmount > 0n
                  ? `Deposit ${formatUsdc(depositAmount)}`
                  : "Deposit";

  const walletReady = wallet.connected && wallet.onElysium;
  const depositDisabled =
    !configured || busy || (walletReady && (!st || paused || blocker !== null)) || wallet.connecting || wallet.switching;
  const showBlocker = walletReady && st && blocker && !paused && depositInput.trim() !== "";

  const withdrawLabel =
    phase === "withdraw-sign" ? "Confirm in your wallet…" : phase === "withdraw-confirm" ? "Waiting for confirmation…" : "Withdraw";

  const alert = shownError ? (
    <ErrorNote
      action={
        wallet.connected && !wallet.onElysium ? (
          <button type="button" className="btn btn-solid shrink-0 px-3.5 py-1.5 text-[11.5px]" onClick={() => void wallet.switchToElysium()}>
            Switch to Elysium
          </button>
        ) : null
      }
    >
      {shownError}
    </ErrorNote>
  ) : null;

  const success = done ? (
    <Note role="status">
      {done.kind === "deposit" ? (
        <>
          Deposited <span className="num text-gold">{formatUsdc(done.assets)}</span>. Your position updates below.
        </>
      ) : (
        <>
          Withdrew <span className="num text-gold">{formatUsdcExact(done.assets)}</span> to your wallet.
        </>
      )}
    </Note>
  ) : null;

  const txLinks =
    hashes.approve || hashes.deposit || hashes.withdraw ? (
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {hashes.approve ? <TxLink hash={hashes.approve}>Approval tx</TxLink> : null}
        {hashes.deposit ? <TxLink hash={hashes.deposit}>Deposit tx</TxLink> : null}
        {hashes.withdraw ? <TxLink hash={hashes.withdraw}>Withdrawal tx</TxLink> : null}
      </div>
    ) : null;

  const feedback =
    alert || success || txLinks ? (
      <div className="grid gap-3">
        {alert}
        {success}
        {txLinks}
      </div>
    ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
      {/* ------------------------------------------------------------ deposit */}
      <form onSubmit={onDeposit} noValidate className="grid content-start gap-6 self-start rounded-[22px] border border-line bg-obsidian-2 p-5 sm:p-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="display text-[32px] sm:text-[40px]">Deposit</h2>
          <span className="stat-key">USDC · Elysium</span>
        </div>

        {!configured ? (
          <Note>
            <strong className="font-medium text-gold">{MSG_NOT_CONFIGURED}</strong> Deposits open here once the Elysium
            contracts are live.
          </Note>
        ) : q.isError && !st ? (
          <Note role="status">
            <strong className="font-medium text-gold">Chain data unavailable</strong> — the pool could not be read from
            Elysium right now. Try again shortly.
          </Note>
        ) : paused ? (
          <Note role="status">
            <strong className="font-medium text-gold">{MSG_PAUSED}.</strong> Withdrawals stay open.
          </Note>
        ) : null}

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor={`${uid}-dep`} className="stat-key">
              Amount
            </label>
            {w ? (
              <span className="num text-[11px] text-mute">Wallet {formatUsdc(w.usdcBalance)}</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <AmountInput
              id={`${uid}-dep`}
              value={depositInput}
              onChange={(v) => {
                setDepositInput(v);
                setError(null);
              }}
              disabled={!configured || busy || paused}
              invalid={!!showBlocker}
              describedBy={showBlocker ? `${uid}-dep-err` : undefined}
            />
            {maxDeposit !== null && maxDeposit > 0n && !paused ? (
              <button
                type="button"
                className="btn shrink-0 px-4 text-[11.5px] text-marble"
                disabled={busy}
                onClick={() => setDepositInput(unitsToInput(maxDeposit))}
              >
                Max
              </button>
            ) : null}
          </div>
          {showBlocker ? (
            <p id={`${uid}-dep-err`} className="text-[12.5px] text-gold">
              {blocker}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 border-t border-line pt-5">
          <RiskNote />
          <p className="num text-[12.5px] text-marble/85">{CAPS_TEXT}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {!wallet.connected ? (
            <button
              type="button"
              className="btn btn-solid disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configured || wallet.connecting}
              onClick={() => {
                setError(null);
                void wallet.connectWallet();
              }}
            >
              {depositLabel}
            </button>
          ) : !wallet.onElysium ? (
            <button
              type="button"
              className="btn btn-solid disabled:cursor-wait disabled:opacity-60"
              disabled={!configured || wallet.switching}
              onClick={() => {
                setError(null);
                void wallet.switchToElysium();
              }}
            >
              {depositLabel}
            </button>
          ) : (
            <button type="submit" className="btn btn-solid disabled:cursor-not-allowed disabled:opacity-60" disabled={depositDisabled}>
              {depositLabel}
            </button>
          )}
        </div>

        {scope === "deposit" ? feedback : null}

        <p className="text-[12px] leading-relaxed text-mute">
          Two transactions: a USDC approval for exactly this amount, then the deposit. No unlimited approvals. Paid in
          HYPE gas on Elysium.
        </p>
      </form>

      {/* ------------------------------------------------------------ position + withdraw */}
      <div className="grid content-start gap-6">
        <section aria-labelledby={`${uid}-pos`} className="grid gap-5 rounded-[22px] border border-line bg-obsidian-2 p-5 sm:p-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id={`${uid}-pos`} className="display text-[28px] sm:text-[32px]">
              Your position
            </h2>
            {q.isFetching && st ? <span className="stat-key">Refreshing</span> : null}
          </div>
          {!walletReady ? (
            <p className="text-[13.5px] leading-relaxed text-mute">
              Connect a wallet on Elysium to see your USDC balance and pool position.
            </p>
          ) : !w ? (
            <p className="text-[13.5px] text-mute">{q.isError ? "Chain data unavailable." : "Reading your position…"}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[16px] border border-line bg-line">
                <StatCell k="Wallet USDC">{formatUsdc(w.usdcBalance)}</StatCell>
                <StatCell k="Position" sub="What your shares convert to now">
                  {formatUsdc(w.positionAssets)}
                </StatCell>
                <StatCell k="Locked" sub="Behind credit lines you back">
                  {formatUsdc(w.lockedAssets)}
                </StatCell>
                <StatCell k="Withdrawable" sub="Unlocked shares">
                  {formatUsdc(w.freeAssets)}
                </StatCell>
              </dl>
              <p className="num text-[11.5px] leading-relaxed text-mute">
                Counted toward your cap: {formatUsdc(w.depositedOf)} of {formatUsdc(st!.pool.maxPerWallet)}
              </p>
            </>
          )}
        </section>

        <section aria-labelledby={`${uid}-wd`} className="grid gap-5 rounded-[22px] border border-line bg-obsidian-2 p-5 sm:p-8">
          <h2 id={`${uid}-wd`} className="display text-[28px] sm:text-[32px]">
            Withdraw
          </h2>
          <div className="grid gap-2">
            <label htmlFor={`${uid}-wdi`} className="stat-key">
              Amount
            </label>
            <AmountInput
              id={`${uid}-wdi`}
              value={withdrawInput}
              onChange={(v) => {
                setWithdrawInput(v);
                setError(null);
              }}
              disabled={!configured || busy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-solid disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configured || busy || (walletReady && (!w || w.freeShares === 0n || !parseUsdInput(withdrawInput)))}
              onClick={() => void onWithdraw(false)}
            >
              {withdrawLabel}
            </button>
            <button
              type="button"
              className="btn text-marble disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configured || busy || (walletReady && (!w || w.freeShares === 0n))}
              onClick={() => void onWithdraw(true)}
            >
              Withdraw all unlocked
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-mute">
            Withdrawals are never paused. Amounts above your unlocked position are reduced to it.
            {lentOut ? (
              <>
                {" "}
                Right now the pool holds <span className="num text-marble/85">{formatUsdc(st!.pool.idleLiquidity)}</span> idle
                USDC; the rest is lent out and returns as loans are repaid.
              </>
            ) : null}
          </p>
          {scope === "withdraw" ? feedback : null}
        </section>
      </div>
    </div>
  );
}

export default LendPanel;
