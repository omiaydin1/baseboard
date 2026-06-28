"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { BASE_CHAIN_ID } from "@/lib/constants";
import { BaseLogo } from "./ChainLogos";
import { Spinner } from "./Spinner";

/**
 * Network indicator/selector for the header. Base is the only supported network
 * (Celo was removed), so this isn't a multi-option dropdown — it shows the Base
 * logo + "Base" label normally, and switches to an amber "Wrong Network"
 * warning when a connected wallet is on a different chain. Tapping the warning
 * fires a real `wallet_switchEthereumChain` request (via wagmi's `switchChain`)
 * to move the wallet back to Base, mirroring `WalletConnect`'s existing
 * chain-guard mechanism; once back on Base the button reverts to its normal
 * "Base" state.
 */
export function NetworkSelector() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const wrongNetwork = isConnected && chainId !== BASE_CHAIN_ID;

  if (wrongNetwork) {
    return (
      <button
        type="button"
        onClick={() =>
          switchChain({
            chainId: BASE_CHAIN_ID as Parameters<
              typeof switchChain
            >[0]["chainId"],
          })
        }
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
        title="Your wallet is on the wrong network — tap to switch to Base"
      >
        {isPending ? (
          <Spinner size={14} className="!border-amber-300 !border-t-amber-600" />
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        Wrong Network
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border-2 border-blue-100 bg-white px-3 py-2 text-sm font-semibold text-base-blue">
      <BaseLogo size={16} className="rounded" />
      Base
    </span>
  );
}
