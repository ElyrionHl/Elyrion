"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useConnection } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { shortAddr } from "@/lib/format";
import { addressInputError, parseAddressInput } from "@/lib/prescore/view";

/**
 * The Pre-Score search field. A real GET form (`/score?address=…`), so it also works without JS; with JS it
 * validates inline (checksum-insensitive) and routes straight to `/score/<lowercased>`.
 */
export function ScoreSearch() {
  const router = useRouter();
  const id = useId();
  const inputId = `${id}-address`;
  const msgId = `${id}-msg`;
  const { address: wallet, status } = useConnection();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const parsed = parseAddressInput(value);
  const error = touched ? addressInputError(value) : null;
  const emptySubmit = touched && !value.trim();

  const go = (addr: string) => {
    setTarget(addr);
    startTransition(() => router.push(`/score/${addr.toLowerCase()}`));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    if (parsed) go(parsed);
  };

  const connected = status === "connected" && !!wallet;
  const busy = pending && target !== null;

  return (
    <div>
      <form action="/score" method="get" noValidate onSubmit={onSubmit}>
        <label htmlFor={inputId} className="stat-key block">
          Paste any Elysium address
        </label>
        <div
          data-invalid={error || emptySubmit ? "true" : undefined}
          className="prescore-field mt-3 flex items-center gap-2 rounded-[18px] border border-line bg-obsidian/70 p-1.5 pl-4 backdrop-blur-sm transition-[border-color,box-shadow] duration-500 focus-within:border-gold/60 focus-within:shadow-[0_0_0_4px_rgba(226,197,139,0.07),0_30px_80px_-40px_rgba(226,197,139,0.35)] data-[invalid=true]:border-marble/35 sm:pl-5"
        >
          <input
            id={inputId}
            name="address"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="0x…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => value.trim() && setTouched(true)}
            aria-invalid={error ? true : undefined}
            aria-describedby={msgId}
            className="num min-w-0 flex-1 bg-transparent py-3.5 text-[14px] text-marble outline-none placeholder:text-marble/45 focus-visible:outline-none sm:py-4 sm:text-[16px]"
          />
          <button type="submit" disabled={busy} className="btn btn-solid shrink-0 px-4 py-3 disabled:cursor-wait sm:px-6">
            {busy && target === parsed ? "Reading…" : (
              <span>
                Read<span className="hidden sm:inline"> the score</span>
              </span>
            )}
          </button>
        </div>
        <p id={msgId} aria-live="polite" className="mt-3 min-h-[18px] font-mono text-[11px] tracking-[0.06em]">
          {error ? (
            <span className="text-marble/85">{error}</span>
          ) : emptySubmit ? (
            <span className="text-marble/85">Paste an address first: 0x followed by 40 characters.</span>
          ) : parsed ? (
            <span className="inline-flex items-center gap-2 text-gold">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
              Ready · {shortAddr(parsed)}
            </span>
          ) : (
            <span className="text-mute">Any wallet on Elysium · capitals optional</span>
          )}
        </p>
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        {connected ? (
          <button type="button" className="btn text-marble" disabled={busy} onClick={() => go(wallet)}>
            {busy && target === wallet ? (
              "Reading…"
            ) : (
              <>
                Use my wallet <span className="num text-mute">{shortAddr(wallet)}</span>
              </>
            )}
          </button>
        ) : (
          <>
            <ConnectButton />
            <span className="text-[12.5px] text-mute">to read your own wallet</span>
          </>
        )}
      </div>
    </div>
  );
}

export default ScoreSearch;
