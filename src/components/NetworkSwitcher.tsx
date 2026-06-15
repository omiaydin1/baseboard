"use client";

import { useEffect, useRef, useState } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import {
  CHAIN_CONFIGS,
  DEV_LOCAL,
  getChainConfig,
  type ChainConfig,
} from "@/lib/constants";
import { ChainLogo } from "./ChainLogos";
import { Spinner } from "./Spinner";

/**
 * Header network switcher. Shows the active chain's logo + name and, on click,
 * a dropdown of every supported chain (Base square mark / Celo circle mark).
 * Selecting one fires the wallet's `wallet_switchEthereumChain` prompt via
 * wagmi's `switchChain`, which also isolates the board to that network.
 */
export function NetworkSwitcher() {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Hidden in dev-local mode (single local chain) — nothing to switch between.
  const chains = CHAIN_CONFIGS;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (DEV_LOCAL || chains.length < 2) return null;

  const active: ChainConfig | undefined = getChainConfig(chainId);
  const activeChainId = active?.chainId ?? chains[0].chainId;
  const activeLabel = active?.shortName ?? "Network";

  const select = (target: number) => {
    setOpen(false);
    if (target === chainId) return;
    setPendingId(target);
    switchChain(
      {
        chainId: target as Parameters<typeof switchChain>[0]["chainId"],
      },
      { onSettled: () => setPendingId(null) },
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-base-blue bg-white px-3 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50 disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {isPending && pendingId != null ? (
          <Spinner size={16} />
        ) : (
          <ChainLogo chainId={activeChainId} size={18} />
        )}
        <span className="hidden sm:inline">{activeLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border-2 border-blue-100 bg-white p-1 shadow-xl"
        >
          {chains.map((c) => {
            const isActive = c.chainId === chainId;
            return (
              <button
                key={c.chainId}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => select(c.chainId)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-blue-50 text-base-blue"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <ChainLogo chainId={c.chainId} size={20} />
                <span className="flex-1">{c.shortName}</span>
                {isActive && (
                  <span className="h-2 w-2 rounded-full bg-base-blue" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
