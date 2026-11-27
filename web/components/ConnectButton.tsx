"use client";

import { useEffect, useRef, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { elysium, explorerAddressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { humanizeError, MSG_NO_WALLET } from "@/lib/tx-errors";
import { ADD_ELYSIUM } from "@/lib/wagmi";

/**
 * Wallet state for Elysium: connect (injected wallets only), switch to chain
 * 99901 (the wallet is asked to add it when it does not know it), disconnect.
 * Errors come back as readable sentences.
 */
export function useElysiumWallet() {
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const disconnect = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  const connected = status === "connected" && !!address;
  const onElysium = connected && chainId === elysium.id;

  async function connectWallet(): Promise<boolean> {
    setError(null);
    const connector = connectors[0];
    const provider = connector ? await connector.getProvider().catch(() => undefined) : undefined;
    if (!connector || !provider) {
      setError(MSG_NO_WALLET);
      return false;
    }
    try {
      await connect.mutateAsync({ connector });
      return true;
    } catch (e) {
      setError(humanizeError(e));
      return false;
    }
  }

  async function switchToElysium(): Promise<boolean> {
    setError(null);
    try {
      await switchChain.mutateAsync({ chainId: elysium.id, addEthereumChainParameter: ADD_ELYSIUM });
      return true;
    } catch (e) {
      setError(humanizeError(e));
      return false;
    }
  }

  return {
    address,
    chainId,
    status,
    connected,
    onElysium,
    connecting: connect.isPending || status === "connecting" || status === "reconnecting",
    switching: switchChain.isPending,
    error,
    clearError: () => setError(null),
    connectWallet,
    switchToElysium,
    disconnect: () => disconnect.mutate(),
  };
}

const PILL = "btn px-4 py-2 text-[12px] disabled:cursor-wait disabled:opacity-60";

/** Nav wallet button: Connect → Switch to Elysium → address menu (explorer, disconnect). */
export function ConnectButton() {
  const w = useElysiumWallet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  let button;
  if (!w.connected) {
    button = (
      <button type="button" className={`${PILL} text-marble`} onClick={() => void w.connectWallet()} disabled={w.connecting}>
        {w.connecting ? (
          "Connecting…"
        ) : (
          <span>
            Connect<span className="hidden sm:inline"> wallet</span>
          </span>
        )}
      </button>
    );
  } else if (!w.onElysium) {
    button = (
      <button type="button" className={`${PILL} btn-solid`} onClick={() => void w.switchToElysium()} disabled={w.switching}>
        {w.switching ? "Switching…" : "Switch to Elysium"}
      </button>
    );
  } else {
    button = (
      <button
        type="button"
        className={`${PILL} num text-marble`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
        <span className="sr-only">Wallet </span>
        {shortAddr(w.address!)}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      {button}

      {open && w.connected ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-2 w-[220px] overflow-hidden rounded-[14px] border border-line bg-obsidian-2 shadow-[0_30px_80px_-40px_rgba(226,197,139,0.35)]"
        >
          <p className="border-b border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
            Elysium · {w.chainId}
          </p>
          <a
            role="menuitem"
            href={explorerAddressUrl(w.address!)}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-3 text-[13px] text-marble/85 transition-colors duration-500 hover:bg-obsidian hover:text-gold"
            onClick={() => setOpen(false)}
          >
            View on explorer ↗
          </a>
          <button
            role="menuitem"
            type="button"
            className="block w-full border-t border-line px-4 py-3 text-left text-[13px] text-marble/85 transition-colors duration-500 hover:bg-obsidian hover:text-gold"
            onClick={() => {
              setOpen(false);
              w.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}

      {w.error ? (
        <div
          role="alert"
          className="absolute top-full right-0 z-40 mt-2 flex w-[min(300px,calc(100vw-32px))] items-start gap-3 rounded-[14px] border border-line bg-obsidian-2 p-4 text-[12.5px] leading-relaxed text-marble/85"
        >
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-gold" />
          <span className="flex-1">{w.error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="-m-1 p-1 font-mono text-[12px] text-mute transition-colors duration-500 hover:text-gold"
            onClick={w.clearError}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ConnectButton;
