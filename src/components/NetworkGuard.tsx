"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import {
  DEFAULT_CHAIN_CONFIG,
  DEV_LOCAL,
  SUPPORTED_CHAIN_IDS,
} from "@/lib/constants";
import { Spinner } from "./Spinner";

/**
 * Sticky warning shown only when a connected wallet is on a network BaseBoard
 * doesn't support (anything other than Base 8453). Offers a one-click switch
 * to Base.
 */
export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const supported = SUPPORTED_CHAIN_IDS.includes(chainId);
  if (!isConnected || supported || DEV_LOCAL) return null;

  return (
    <div className="w-full bg-amber-500 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-4 py-2 text-sm font-medium">
        <span>
          Unsupported network. BaseBoard runs on <strong>Base</strong>.
        </span>
        <button
          type="button"
          onClick={() =>
            switchChain({
              chainId: DEFAULT_CHAIN_CONFIG.chainId as Parameters<
                typeof switchChain
              >[0]["chainId"],
            })
          }
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
        >
          {isPending && <Spinner size={14} />}
          Switch to {DEFAULT_CHAIN_CONFIG.shortName}
        </button>
      </div>
    </div>
  );
}
