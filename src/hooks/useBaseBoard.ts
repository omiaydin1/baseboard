"use client";

import { useCallback, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { base } from "viem/chains";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import {
  ACTIVE_CHAIN_ID,
  DISPLAY_MAX_PLOTS,
  IS_CONTRACT_CONFIGURED,
  ZERO_ADDRESS,
} from "@/lib/constants";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";

const sharedReadConfig = {
  address: baseBoardAddress,
  abi: baseBoardAbi,
} as const;

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

export function usePlot(plotId: number | null) {
  const { refreshNonce } = useBoardStore();
  const enabled = IS_CONTRACT_CONFIGURED && plotId != null;

  const query = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlot",
    args: plotId != null ? [BigInt(plotId)] : undefined,
    query: { enabled },
  });

  useEffect(() => {
    if (enabled) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const plot = query.data as Plot | undefined;
  const isOwned = !!plot && plot.owner.toLowerCase() !== ZERO_ADDRESS;

  return { plot, isOwned, ...query };
}

export function useOffer(plotId: number | null, bidder?: `0x${string}`) {
  const enabled = IS_CONTRACT_CONFIGURED && plotId != null && !!bidder;
  return useReadContract({
    ...sharedReadConfig,
    functionName: "offers",
    args: plotId != null && bidder ? [BigInt(plotId), bidder] : undefined,
    query: { enabled },
  });
}

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

export function useBaseBoardWrite() {
  const bumpRefresh = useBoardStore((s) => s.bumpRefresh);
  const { connector } = useAccount();
  const {
    writeContract,
    writeContractAsync,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    if (isSuccess) bumpRefresh();
  }, [isSuccess, bumpRefresh]);

  type WriteAsync = typeof writeContractAsync;
  const writeContractAsyncGuarded = useCallback<WriteAsync>(
    ((variables, options) => {
      const doWrite = () =>
        writeContractAsync(
          { ...variables, chainId: ACTIVE_CHAIN_ID, chain: base },
          options,
        );

      const ensureBaseAndWrite = async () => {
        if (connector) {
          const provider = await connector.getProvider() as {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
          const rawId = await provider.request({ method: "eth_chainId" }) as string;
          const realChainId = parseInt(rawId, 16);
          if (realChainId !== ACTIVE_CHAIN_ID) {
            const hexChainId = `0x${ACTIVE_CHAIN_ID.toString(16)}`;
            try {
              await provider.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: hexChainId }],
              });
            } catch (switchErr: unknown) {
              const code = (switchErr as { code?: number })?.code;
              if (code === 4902 || code === -32603) {
                await provider.request({
                  method: "wallet_addEthereumChain",
                  params: [{
                    chainId: hexChainId,
                    chainName: "Base",
                    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://mainnet.base.org"],
                    blockExplorerUrls: ["https://basescan.org"],
                  }],
                });
              } else {
                throw new Error("Please switch to Base Mainnet in your wallet to continue.");
              }
            }
          }
        }
        return doWrite();
      };

      return ensureBaseAndWrite();
    }) as WriteAsync,
    [writeContractAsync, switchChainAsync, connector],
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
