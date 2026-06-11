"use client";

import { useCallback, useEffect } from "react";
import {
  useChainId,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import {
  ACTIVE_CHAIN_ID,
  DISPLAY_MAX_PLOTS,
  IS_CONTRACT_CONFIGURED,
  TARGET_CHAIN,
  ZERO_ADDRESS,
} from "@/lib/constants";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";

const sharedReadConfig = {
  address: baseBoardAddress,
  abi: baseBoardAbi,
} as const;

/** Live "sold" / "remaining" counters with polling + event-driven refresh. */
export function useBoardStats() {
  const { data, refetch, isLoading } = useReadContract({
    ...sharedReadConfig,
    functionName: "totalPlotsSold",
    query: {
      enabled: IS_CONTRACT_CONFIGURED,
      refetchInterval: 15_000,
    },
  });

  useWatchContractEvent({
    ...sharedReadConfig,
    eventName: "PlotsPurchased",
    enabled: IS_CONTRACT_CONFIGURED,
    onLogs: () => {
      void refetch();
    },
  });

  const sold = IS_CONTRACT_CONFIGURED && data != null ? Number(data) : 0;
  const remaining = Math.max(0, DISPLAY_MAX_PLOTS - sold);

  return { sold, remaining, isLoading, refetch };
}

/** Read a single plot's on-chain record. */
export function usePlot(plotId: number | null) {
  const { refreshNonce } = useBoardStore();
  const enabled = IS_CONTRACT_CONFIGURED && plotId != null;

  const query = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlot",
    args: plotId != null ? [BigInt(plotId)] : undefined,
    query: { enabled },
  });

  // Refetch whenever a tx settles elsewhere in the app.
  useEffect(() => {
    if (enabled) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const plot = query.data as Plot | undefined;
  const isOwned = !!plot && plot.owner.toLowerCase() !== ZERO_ADDRESS;

  return { plot, isOwned, ...query };
}

/** Read the escrowed offer a bidder has on a plot. */
export function useOffer(plotId: number | null, bidder?: `0x${string}`) {
  const enabled = IS_CONTRACT_CONFIGURED && plotId != null && !!bidder;
  return useReadContract({
    ...sharedReadConfig,
    functionName: "offers",
    args: plotId != null && bidder ? [BigInt(plotId), bidder] : undefined,
    query: { enabled },
  });
}

/** All plot ids owned by an address. */
export function usePlotsByOwner(account?: `0x${string}`) {
  const { refreshNonce } = useBoardStore();
  const enabled = IS_CONTRACT_CONFIGURED && !!account;

  const query = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlotsByOwner",
    args: account ? [account] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });

  useEffect(() => {
    if (enabled) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const ids = ((query.data as readonly bigint[] | undefined) ?? []).map((b) =>
    Number(b),
  );

  return { ids, ...query };
}

/**
 * Generic write helper that exposes a typed `write()` plus tx lifecycle flags
 * and bumps the global refresh nonce once the receipt confirms.
 */
export function useBaseBoardWrite() {
  const bumpRefresh = useBoardStore((s) => s.bumpRefresh);
  const chainId = useChainId();
  const {
    writeContract,
    writeContractAsync,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    if (isSuccess) bumpRefresh();
  }, [isSuccess, bumpRefresh]);

  // Enforce Base-only writes: reject before signing if the wallet is on the
  // wrong chain, and always pin the tx to the active chain so wagmi guards it.
  // Typed as the full generic writer so call-site argument inference (e.g. the
  // payable `value` on `buyPlots`) is preserved.
  type WriteAsync = typeof writeContractAsync;
  const writeContractAsyncGuarded = useCallback<WriteAsync>(
    ((variables, options) => {
      if (chainId !== ACTIVE_CHAIN_ID) {
        return Promise.reject(
          new Error("Wrong network — switch to Base Mainnet to continue"),
        );
      }
      return writeContractAsync(
        { ...variables, chainId: ACTIVE_CHAIN_ID },
        options,
      );
    }) as WriteAsync,
    [writeContractAsync, chainId],
  );

  const status = isPending
    ? "pending"
    : isConfirming
      ? "confirming"
      : isSuccess
        ? "success"
        : error
          ? "error"
          : "idle";

  return {
    /**
     * Typed wagmi writer, guarded so it only transacts on Base Mainnet (8453).
     * Call with the contract config inline so wagmi infers argument types from
     * the literal `functionName`, e.g.
     * `writeContractAsync({ address, abi, functionName: "buyPlots", args: [ids], value })`.
     */
    writeContractAsync: writeContractAsyncGuarded,
    writeContract,
    hash,
    status,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}
