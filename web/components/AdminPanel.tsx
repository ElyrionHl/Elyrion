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
import { isTreasury, MSG_TREASURY_ONLY, readAdminState } from "@/lib/admin";
import { elysium, explorerAddressUrl } from "@/lib/chain";
import { formatUsdc, formatUsdcExact, shortAddr } from "@/lib/format";
import { humanizeError, MSG_NOT_CONFIGURED } from "@/lib/tx-errors";

/** Admin wording for errors whose generic sentence is about requesting a line. */
const ADMIN_ERRORS: Record<string, string> = {
  BadAmount: "Not enough unlocked treasury shares to back this amount, or there is nothing to claim.",
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
 * Pending line requests → openLine(min(request, $50)); active treasury-backed lines → closeLine;
 * sponsor fees → claimSponsorFees.
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

  const configured = !!identity && !!pool && !!treasury;
  const allowed = configured && wallet.onElysium && isTreasury(wallet.address, treasury);

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
          <strong className="font-medium text-gold">{MSG_TREASURY_ONLY}.</strong> Connect the treasury wallet on Elysium
          to see the line queue.
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
                  const short = s.treasury.freeAssets < p.openAmount;
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
                        {short ? <p className="mt-1.5 text-[12px] text-gold">Not enough unlocked treasury shares.</p> : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-solid w-fit disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={anyBusy || short}
                        onClick={() => void send(key, `Open line #${p.agentId}`, "openLine", [p.agentId, p.openAmount])}
                      >
                        {label(key, `Open line · ${formatUsdc(p.openAmount)}`)}
                      </button>
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
