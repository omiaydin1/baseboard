"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/constants";
import { Spinner } from "./Spinner";

/**
 * Renders a sticky warning banner whenever a connected wallet is on the wrong
 * network, with a one-click switch to Base Mainnet (8453).
 */
export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === TARGET_CHAIN_ID) return null;

  return (
    <div className="w-full bg-amber-500 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-4 py-2 text-sm font-medium">
        <span>
          Wrong network detected. BaseBoard runs on{" "}
          <strong>Base Mainnet (8453)</strong>.
        </span>
        <button
          type="button"
          onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
        >
          {isPending && <Spinner size={14} />}
          Switch to Base
        </button>
      </div>
    </div>
  );
}
