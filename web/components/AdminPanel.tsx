"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Address, Hash, PublicClient } from "viem";
import { useConfig, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useElysiumWallet } from "@/components/ConnectButton";
import { ErrorNote, Note, StatCell, TxLink } from "@/components/TxUi";
import { poolAbi } from "@/lib/abi/ElyrionPool";
import {
  adminGate,
  clampOpen,
  STEP_UP_AFTER,
  MSG_POOL_PAUSED,
  MSG_TREASURY_ONLY,
  MSG_TREASURY_WRONG_CHAIN,
  readAdminState,
  type PendingItem,
} from "@/lib/admin";
import { elysium, explorerAddressUrl } from "@/lib/chain";
import { formatUsdc, formatUsdcExact, shortAddr } from "@/lib/format";
import { parseUsdInput } from "@/lib/lend";
import { humanizeError, MSG_NOT_CONFIGURED } from "@/lib/tx-errors";

/** Admin wording for errors whose generic sentence is about requesting a line. */
const ADMIN_ERRORS: Record<string, string> = {
  BadAmount:
    "Not allowed: a line must be at least $5 and at most the request and the pool's max loan, backed by enough unlocked treasury shares (or there is nothing to claim).",
  AgentDefaulted: "This agent has defaulted; its line cannot be opened.",
};

type Busy = { key: string; stage: "sign" | "confirm" } | null;

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="grid gap-4 bg-obsidian-2 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">{children}</li>
  );
}

/**
 * Treasury convenience UI (not security: the contract enforces backer rules).
 * Pending line requests → openLine(amount): $5 by default for a new agent, $25 offered once the agent has
 * 3 qualified repayments on treasury-backed loans; editable, clamped to [$5, min(request, maxLoan)].
 * Active treasury-backed lines → closeLine; sponsor fees → claimSponsorFees.
 */
export function AdminPanel({
  identity,
  pool,
  treasury,
  deployBlock,
}: {
  identity?: Address;
  pool?: Address;
  treasury?: Address;
  deployBlock: string;
}) {
  const config = useConfig();
  const client = usePublicClient({ chainId: elysium.id }) as PublicClient | undefined;
  const wallet = useElysiumWallet();
  const write = useWriteContract();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ label: string; hash: Hash } | null>(null);
  /** Typed amounts per pending agent (dollars); absent = the policy default. */
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const configured = !!identity && !!pool && !!treasury && /^[1-9]\d*$/.test(deployBlock);
  const gate = adminGate({
    configured,
    connected: wallet.connected,
    onElysium: wallet.onElysium,
    address: wallet.address,
    treasury,
  });
  const allowed = gate === "ok";

  const q = useQuery({
    queryKey: ["admin", pool, treasury],
    enabled: allowed && !!client,
    queryFn: () => readAdminState(client!, { identity: identity!, pool: pool!, fromBlock: BigInt(deployBlock) }, treasury!),
    refetchInterval: 20_000,
  });

  async function send(key: string, label: string, functionName: "openLine" | "closeLine" | "claimSponsorFees", args: readonly bigint[]) {
    if (busy || !allowed) return;
    setError(null);
    setLast(null);
    try {
      setBusy({ key, stage: "sign" });
      const hash = await write.mutateAsync({
        address: pool!,
        abi: poolAbi,
        functionName,
        args: args as never,
        chainId: elysium.id,
      } as never);
      setLast({ label, hash });
      setBusy({ key, stage: "confirm" });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: elysium.id });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
    } catch (err) {
      setError(humanizeError(err, ADMIN_ERRORS));
    } finally {
      setBusy(null);
      void q.refetch();
    }
  }

  const label = (key: string, idle: string) =>
    busy?.key === key ? (busy.stage === "sign" ? "Confirm in wallet…" : "Confirming…") : idle;

  if (!configured) {
    return (
      <Note>
        <strong className="font-medium text-gold">{MSG_NOT_CONFIGURED}</strong> The line queue appears here once the
        contracts and treasury address are set.
      </Note>
    );
  }

  if (!allowed) {
    return (
      <div className="grid max-w-[560px] gap-5">
        <Note role="status">
          {gate === "wrong-chain" ? (
            <strong className="font-medium text-gold">{MSG_TREASURY_WRONG_CHAIN}</strong>
          ) : (
            <>
              <strong className="font-medium text-gold">{MSG_TREASURY_ONLY}.</strong> Connect the treasury wallet on
              Elysium to see the line queue.
            </>
          )}
        </Note>
        {!wallet.connected ? (
          <button type="button" className="btn btn-solid w-fit" disabled={wallet.connecting} onClick={() => void wallet.connectWallet()}>
            {wallet.connecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : !wallet.onElysium ? (
          <button type="button" className="btn btn-solid w-fit" disabled={wallet.switching} onClick={() => void wallet.switchToElysium()}>
            {wallet.switching ? "Switching…" : "Switch to Elysium"}
          </button>
        ) : null}
        {wallet.error ? <ErrorNote>{wallet.error}</ErrorNote> : null}
      </div>
    );
  }

  const s = q.data;
  const anyBusy = busy !== null;

  /** The amount "Open line" sends for a pending row: typed (or policy default), clamped; null when invalid. */
  const amountFor = (p: PendingItem, maxLoan: bigint): bigint | null => {
    const typed = amounts[p.agentId.toString()];
    if (typed === undefined) return p.defaultAmount;
    const v = parseUsdInput(typed);
    return v === null ? null : clampOpen(v, p.requested, maxLoan);
  };
  const setAmount = (p: PendingItem, v: string) => setAmounts((m) => ({ ...m, [p.agentId.toString()]: v }));
  const dollars = (v: bigint) => (Number(v / 10_000n) / 100).toString();

  return (
    <div className="grid gap-10">
      {error || last ? (
        <div className="grid gap-3">
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {last ? <TxLink hash={last.hash}>{last.label} tx</TxLink> : null}
        </div>
      ) : null}

      {!s ? (
        <Note role="status">{q.isError ? "Chain data unavailable. Try again shortly." : "Reading the line queue…"}</Note>
      ) : (
        <>
          {s.treasuryMismatch ? (
            <ErrorNote>
              The configured treasury address is not this pool&apos;s treasury (pool.treasury()). Check
              NEXT_PUBLIC_TREASURY before opening lines.
            </ErrorNote>
          ) : null}
          {s.paused ? <Note role="status">{MSG_POOL_PAUSED}</Note> : null}

          <section aria-labelledby="adm-treasury" className="grid gap-5">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="adm-treasury" className="display text-[32px]">
                Treasury wallet
              </h2>
              <a
                href={explorerAddressUrl(treasury!)}
                target="_blank"
                rel="noopener noreferrer"
                className="num text-[12px] text-gold transition-colors duration-500 hover:text-marble"
              >
                {shortAddr(treasury!)} ↗
              </a>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line bg-line lg:grid-cols-4">
              <StatCell k="Position">{formatUsdc(s.treasury.positionAssets)}</StatCell>
              <StatCell k="Locked">{formatUsdc(s.treasury.lockedAssets)}</StatCell>
              <StatCell k="Unlocked">{formatUsdc(s.treasury.freeAssets)}</StatCell>
              <StatCell k="Backer fees" sub="sponsorFees(treasury)">
                {formatUsdcExact(s.treasury.sponsorFees)}
              </StatCell>
            </dl>
            <button
              type="button"
              className="btn btn-solid w-fit disabled:cursor-not-allowed disabled:opacity-60"
              disabled={anyBusy || s.treasury.sponsorFees === 0n}
              onClick={() => void send("claim", "Claim fees", "claimSponsorFees", [])}
            >
              {label("claim", `Claim fees · ${formatUsdcExact(s.treasury.sponsorFees)}`)}
            </button>
          </section>

          <section aria-labelledby="adm-pending" className="grid gap-5">
            <h2 id="adm-pending" className="display text-[32px]">
              Pending requests <span className="num text-[18px] text-mute">{s.pending.length}</span>
            </h2>
            {s.pending.length === 0 ? (
              <p className="rounded-[16px] border border-line bg-obsidian-2 p-6 text-[14px] text-mute">No pending line requests.</p>
            ) : (
              <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line">
                {s.pending.map((p) => {
                  const key = `open-${p.agentId}`;
                  const amount = amountFor(p, s.maxLoan);
                  const short = amount !== null && s.treasury.freeAssets < amount;
                  const typed = amounts[p.agentId.toString()] ?? (p.defaultAmount !== null ? dollars(p.defaultAmount) : "");
                  return (
                    <Row key={key}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <Link href={`/agent/${p.agentId}`} className="display text-[22px] break-words transition-colors duration-500 hover:text-gold">
                            {p.name}
                          </Link>
                          <span className="num text-[12px] text-mute">#{p.agentId.toString()}</span>
                        </p>
                        <p className="num mt-1.5 text-[12px] text-mute">
                          Requested <span className="text-marble/85">{formatUsdc(p.requested)}</span> · owner{" "}
                          <a href={explorerAddressUrl(p.owner)} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-marble">
                            {shortAddr(p.owner)}
                          </a>
                        </p>
                        <p className="num mt-1.5 text-[12px] text-mute">
                          Score <span className="text-marble/85">{p.score.toString()}</span> · repaid{" "}
                          <span className="text-marble/85">{p.repaidCount.toString()}</span> · qualified{" "}
                          <span className="text-marble/85">{p.qualifiedRepaid.toString()}</span> · on treasury lines{" "}
                          <span className="text-marble/85">
                            {p.treasuryQualified}/{STEP_UP_AFTER}
                          </span>
                        </p>
                        <p className="num mt-1.5 text-[12px] break-words text-mute">
                          Past backers:{" "}
                          {p.pastBackers.length === 0
                            ? "none"
                            : p.pastBackers.map((b, i) => (
                                <span key={b}>
                                  {i > 0 ? ", " : null}
                                  <a href={explorerAddressUrl(b)} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-marble">
                                    {treasury && b.toLowerCase() === treasury.toLowerCase() ? "treasury" : shortAddr(b)}
                                  </a>
                                </span>
                              ))}
                        </p>
                        {short ? <p className="mt-1.5 text-[12px] text-gold">Not enough unlocked treasury shares.</p> : null}
                        {amount === null ? (
                          <p className="mt-1.5 text-[12px] text-gold">
                            Enter $5 to {p.maxAmount !== null ? formatUsdc(p.maxAmount) : "the request"}.
                          </p>
                        ) : null}
                      </div>
                      <div className="grid w-fit gap-2.5 sm:justify-items-end">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="sr-only" htmlFor={`amt-${p.agentId}`}>
                            Line amount for agent #{p.agentId.toString()} in USD
                          </label>
                          <span className="num text-[12px] text-mute">$</span>
                          <input
                            id={`amt-${p.agentId}`}
                            inputMode="decimal"
                            value={typed}
                            onChange={(e) => setAmount(p, e.target.value)}
                            className="num w-20 rounded-full border border-line bg-obsidian px-3 py-1.5 text-[12.5px] text-marble"
                          />
                          {p.defaultAmount !== null ? (
                            <button type="button" className="btn px-3 py-1.5 text-[11px] text-marble" onClick={() => setAmount(p, dollars(p.defaultAmount!))}>
                              {formatUsdc(p.defaultAmount)} new agent
                            </button>
                          ) : null}
                          {p.stepUpAmount !== null ? (
                            <button type="button" className="btn px-3 py-1.5 text-[11px] text-gold" onClick={() => setAmount(p, dollars(p.stepUpAmount!))}>
                              {formatUsdc(p.stepUpAmount)} · {STEP_UP_AFTER} repaid
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="btn btn-solid w-fit disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={anyBusy || short || amount === null || s.paused}
                          title={s.paused ? MSG_POOL_PAUSED : undefined}
                          onClick={() => {
                            if (amount !== null) void send(key, `Open line #${p.agentId}`, "openLine", [p.agentId, amount]);
                          }}
                        >
                          {label(key, amount !== null ? `Open line · ${formatUsdc(amount)}` : "Open line")}
                        </button>
                      </div>
                    </Row>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="adm-backed" className="grid gap-5">
            <h2 id="adm-backed" className="display text-[32px]">
              Lines this treasury backs <span className="num text-[18px] text-mute">{s.backed.length}</span>
            </h2>
            {s.backed.length === 0 ? (
              <p className="rounded-[16px] border border-line bg-obsidian-2 p-6 text-[14px] text-mute">No active lines.</p>
            ) : (
              <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line">
                {s.backed.map((b) => {
                  const key = `close-${b.agentId}`;
                  const open = b.openLoanId !== 0n;
                  return (
                    <Row key={key}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <Link href={`/agent/${b.agentId}`} className="display text-[22px] break-words transition-colors duration-500 hover:text-gold">
                            {b.name}
                          </Link>
                          <span className="num text-[12px] text-mute">#{b.agentId.toString()}</span>
                        </p>
                        <p className="num mt-1.5 text-[12px] text-mute">
                          Line <span className="text-marble/85">{formatUsdc(b.lineAmount)}</span> ·{" "}
                          {open ? `open loan #${b.openLoanId}` : "no open loan"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn w-fit text-marble disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={anyBusy || open}
                        title={open ? "Close after the open loan is repaid" : undefined}
                        onClick={() => void send(key, `Close line #${b.agentId}`, "closeLine", [b.agentId])}
                      >
                        {label(key, "Close line")}
                      </button>
                    </Row>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default AdminPanel;
