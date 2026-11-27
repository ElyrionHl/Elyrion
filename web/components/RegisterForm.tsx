"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { parseEventLogs, type Address, type Hash } from "viem";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { GateLogo } from "@/components/brand/GateLogo";
import { useElysiumWallet } from "@/components/ConnectButton";
import { TxLink } from "@/components/TxUi";
import {
  buildAgentURI,
  DESCRIPTION_MAX,
  NAME_MAX,
  normalizeRegistration,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationInput,
} from "@/lib/agent-uri";
import { identityAbi } from "@/lib/abi/ElyrionIdentity";
import { poolAbi } from "@/lib/abi/ElyrionPool";
import { elysium } from "@/lib/chain";
import { humanizeError, MSG_NOT_CONFIGURED, MSG_WRONG_CHAIN } from "@/lib/tx-errors";

/** $5 starter line (USDC, 6 decimals). */
export const STARTER_LINE = 5_000_000n;

type Phase = "idle" | "reg-sign" | "reg-confirm" | "line-sign" | "line-confirm";

const EMPTY: RegistrationInput = { name: "", description: "", endpoint: "" };
const chars = (s: string) => [...s].length;

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="stat-key">
          {label}
        </label>
        {hint ? <span className="num text-[11px] text-mute">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-[12.5px] text-gold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const INPUT =
  "w-full min-w-0 rounded-[12px] border border-line bg-obsidian px-4 py-3 text-[14.5px] text-marble placeholder:text-mute/70 transition-colors duration-500 outline-none hover:border-gold/30 focus:border-gold/60 aria-[invalid=true]:border-gold/70";

/**
 * Register an agent: builds the ERC-8004-compatible registration file as a
 * data URI, calls `ElyrionIdentity.register`, reads the new id from the
 * `Registered` event, then optionally `requestLine(id, $5)`.
 */
export function RegisterForm({ identity, pool }: { identity?: Address; pool?: Address }) {
  const uid = useId();
  const config = useConfig();
  const wallet = useElysiumWallet();
  const write = useWriteContract();

  const [values, setValues] = useState<RegistrationInput>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof RegistrationInput, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [regHash, setRegHash] = useState<Hash | null>(null);
  const [agentId, setAgentId] = useState<bigint | null>(null);
  const [lineHash, setLineHash] = useState<Hash | null>(null);
  const [lineDone, setLineDone] = useState(false);

  const configured = !!identity && !!pool;
  const errors: RegistrationErrors = validateRegistration(values);
  const show = (k: keyof RegistrationInput) => (submitted || touched[k] ? errors[k] : undefined);
  const busy = phase !== "idle";
  const shownError = error ?? wallet.error;

  const set = (k: keyof RegistrationInput) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const blur = (k: keyof RegistrationInput) => () => setTouched((t) => ({ ...t, [k]: true }));

  function guard(): boolean {
    setError(null);
    wallet.clearError();
    if (!configured) {
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

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || busy || !guard()) return;
    try {
      setPhase("reg-sign");
      const hash = await write.mutateAsync({
        address: identity!,
        abi: identityAbi,
        functionName: "register",
        args: [buildAgentURI(normalizeRegistration(values))],
        chainId: elysium.id,
      });
      setRegHash(hash);
      setPhase("reg-confirm");
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: elysium.id });
      if (receipt.status !== "success") throw new Error("The registration transaction reverted.");
      const ev = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: receipt.logs }).find(
        (l) => l.address.toLowerCase() === identity!.toLowerCase(),
      );
      if (!ev) throw new Error("Registered event not found in the receipt.");
      setAgentId(ev.args.agentId);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setPhase("idle");
    }
  }

  async function onRequestLine() {
    if (agentId === null || busy || !guard()) return;
    try {
      setPhase("line-sign");
      const hash = await write.mutateAsync({
        address: pool!,
        abi: poolAbi,
        functionName: "requestLine",
        args: [agentId, STARTER_LINE],
        chainId: elysium.id,
      });
      setLineHash(hash);
      setPhase("line-confirm");
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: elysium.id });
      if (receipt.status !== "success") throw new Error("The line request transaction reverted.");
      setLineDone(true);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setPhase("idle");
    }
  }

  function reset() {
    setValues(EMPTY);
    setTouched({});
    setSubmitted(false);
    setError(null);
    setRegHash(null);
    setAgentId(null);
    setLineHash(null);
    setLineDone(false);
  }

  const alert = shownError ? (
    <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-gold/30 bg-obsidian p-4 text-[13px] leading-relaxed text-marble/90">
      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold" />
      <span className="min-w-0 flex-1">{shownError}</span>
      {wallet.connected && !wallet.onElysium ? (
        <button type="button" className="btn btn-solid shrink-0 px-3.5 py-1.5 text-[11.5px]" onClick={() => void wallet.switchToElysium()}>
          Switch to Elysium
        </button>
      ) : null}
    </div>
  ) : null;

  // ---------------------------------------------------------------- registered
  if (agentId !== null && regHash) {
    const id = agentId.toString();
    return (
      <div className="grid gap-8">
        <div className="flex items-center gap-5">
          <GateLogo size={56} animated open title="Registered" />
          <div className="min-w-0">
            <p className="stat-key">Registered on Elysium</p>
            <p className="display mt-2 text-[40px]">
              Agent <span className="num text-gold">#{id}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <TxLink hash={regHash}>Registration tx</TxLink>
          <Link href={`/agent/${id}`} className="text-[12.5px] text-marble/85 underline decoration-line underline-offset-4 transition-colors duration-500 hover:text-gold">
            View profile →
          </Link>
        </div>

        <div className="grid gap-4 rounded-[16px] border border-line bg-obsidian p-5 sm:p-6">
          <p className="stat-key">Optional · starter line</p>
          {lineDone && lineHash ? (
            <>
              <p className="display text-[28px]">
                <span className="num">$5</span> line requested.
              </p>
              <p className="text-[13.5px] leading-relaxed text-mute">
                The request now waits on-chain for a backer to open it by locking pool shares. Lending opens after
                Genesis.
              </p>
              <TxLink hash={lineHash}>Line request tx</TxLink>
            </>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed text-mute">
                Ask for a <span className="num text-marble">$5</span> USDC credit line for Agent #{id}. It records the
                request on-chain; a backer opens it later by locking pool shares. Lending opens after Genesis.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" className="btn btn-solid disabled:cursor-wait disabled:opacity-60" onClick={() => void onRequestLine()} disabled={busy}>
                  {phase === "line-sign"
                    ? "Confirm in your wallet…"
                    : phase === "line-confirm"
                      ? "Waiting for confirmation…"
                      : "Request a $5 line"}
                </button>
                {lineHash && !lineDone ? <TxLink hash={lineHash}>Line request tx</TxLink> : null}
              </div>
            </>
          )}
        </div>

        {alert}

        <button type="button" className="w-fit text-[12.5px] text-mute underline decoration-line underline-offset-4 transition-colors duration-500 hover:text-gold" onClick={reset}>
          Register another agent
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- form
  const submitLabel = !wallet.connected
    ? wallet.connecting
      ? "Connecting…"
      : "Connect wallet"
    : !wallet.onElysium
      ? "Switch to Elysium"
      : phase === "reg-sign"
        ? "Confirm in your wallet…"
        : phase === "reg-confirm"
          ? "Waiting for confirmation…"
          : "Register agent";

  return (
    <form onSubmit={onRegister} noValidate className="grid gap-7">
      {!configured ? (
        <div className="flex items-start gap-3 rounded-[14px] border border-line bg-obsidian p-4 text-[13px] leading-relaxed text-marble/85">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold/60" />
          <span>
            <strong className="font-medium text-gold">{MSG_NOT_CONFIGURED}</strong> Registration opens here as soon as the
            Elysium contracts are live.
          </span>
        </div>
      ) : null}

      <fieldset disabled={!configured || busy} className="grid gap-6 disabled:opacity-60">
        <legend className="sr-only">Agent details</legend>
        <Field id={`${uid}-name`} label="Name" hint={`${chars(values.name.trim())}/${NAME_MAX}`} error={show("name")}>
          <input
            id={`${uid}-name`}
            className={INPUT}
            value={values.name}
            onChange={set("name")}
            onBlur={blur("name")}
            placeholder="Atlas"
            autoComplete="off"
            required
            aria-invalid={!!show("name")}
            aria-describedby={show("name") ? `${uid}-name-err` : undefined}
          />
        </Field>
        <Field
          id={`${uid}-desc`}
          label="Description"
          hint={`${chars(values.description.trim())}/${DESCRIPTION_MAX}`}
          error={show("description")}
        >
          <textarea
            id={`${uid}-desc`}
            className={`${INPUT} min-h-[112px] resize-y`}
            value={values.description}
            onChange={set("description")}
            onBlur={blur("description")}
            placeholder="What the agent does, in a sentence or two."
            aria-invalid={!!show("description")}
            aria-describedby={show("description") ? `${uid}-desc-err` : undefined}
          />
        </Field>
        <Field id={`${uid}-ep`} label="Endpoint" hint="optional · https://" error={show("endpoint")}>
          <input
            id={`${uid}-ep`}
            className={`${INPUT} num`}
            type="url"
            inputMode="url"
            value={values.endpoint}
            onChange={set("endpoint")}
            onBlur={blur("endpoint")}
            placeholder="https://your-agent.example/mcp"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!show("endpoint")}
            aria-describedby={show("endpoint") ? `${uid}-ep-err` : undefined}
          />
        </Field>
      </fieldset>

      {alert}

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
            {submitLabel}
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
            {wallet.switching ? "Switching…" : submitLabel}
          </button>
        ) : (
          <button type="submit" className="btn btn-solid disabled:cursor-wait disabled:opacity-60" disabled={!configured || busy}>
            {submitLabel}
          </button>
        )}
        {regHash ? <TxLink hash={regHash}>Registration tx</TxLink> : null}
      </div>
      <p className="text-[12px] leading-relaxed text-mute">
        One transaction on Elysium, paid in HYPE gas. Your wallet becomes the agent&apos;s owner. The name, description
        and endpoint are stored on-chain and are public.
      </p>
    </form>
  );
}

export default RegisterForm;
