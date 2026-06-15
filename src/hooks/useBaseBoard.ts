"use client";

import { useCallback, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { base, celo, hardhat } from "viem/chains";
import type { Chain } from "viem";
import { baseBoardAbi } from "@/lib/contract";
import {
  DEFAULT_CHAIN_CONFIG,
  DISPLAY_MAX_PLOTS,
  getChainConfig,
  ZERO_ADDRESS,
} from "@/lib/constants";
import { useActiveChainConfig } from "./useActiveContract";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";
import { parseLink, parseZone } from "@/lib/image";

/** viem chain object for a given chain id (for pinning write transactions). */
function viemChainFor(chainId: number): Chain {
  switch (chainId) {
    case celo.id:
      return celo;
    case hardhat.id:
      return hardhat;
    default:
      return base;
  }
}

export function useBoardStats() {
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;

  const { data, refetch, isLoading } = useReadContract({
    ...sharedReadConfig,
    functionName: "totalPlotsSold",
    query: {
      enabled: cfg.isConfigured,
      refetchInterval: 15_000,
    },
  });

  useWatchContractEvent({
    ...sharedReadConfig,
    eventName: "PlotsPurchased",
    enabled: cfg.isConfigured,
    onLogs: () => {
      void refetch();
    },
  });

  const sold = cfg.isConfigured && data != null ? Number(data) : 0;
  const remaining = Math.max(0, DISPLAY_MAX_PLOTS - sold);

  return { sold, remaining, isLoading, refetch };
}

export function usePlot(plotId: number | null) {
  const { refreshNonce } = useBoardStore();
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;
  const enabled = cfg.isConfigured && plotId != null;

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
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;
  const enabled = cfg.isConfigured && plotId != null && !!bidder;
  return useReadContract({
    ...sharedReadConfig,
    functionName: "offers",
    args: plotId != null && bidder ? [BigInt(plotId), bidder] : undefined,
    query: { enabled },
  });
}

export function usePlotsByOwner(account?: `0x${string}`) {
  const { refreshNonce } = useBoardStore();
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;
  const enabled = cfg.isConfigured && !!account;

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
 * Resolve the image + link metadata covering a plot at (x, y). A multi-plot
 * image lives on a single anchor plot with a `#bb=x1,y1,x2,y2` zone fragment
 * that spans the whole selection, so a clicked pixel inside the zone (but not
 * the anchor) carries no metadata of its own. This looks up the plot owner's
 * plots and returns the spanning image/link whose zone covers (x, y) — so
 * every covered pixel reads the same destination link with zero extra writes.
 */
export function useCoveringImage(
  owner: `0x${string}` | undefined,
  x: number | null,
  y: number | null,
  enabled: boolean,
) {
  const { refreshNonce } = useBoardStore();
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;
  const canRun =
    enabled && cfg.isConfigured && !!owner && x != null && y != null;

  const ownerPlots = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlotsByOwner",
    args: owner ? [owner] : undefined,
    query: { enabled: canRun },
  });

  const ids = (ownerPlots.data as readonly bigint[] | undefined) ?? [];

  const batch = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlotsBatch",
    args: ids.length ? [Array.from(ids)] : undefined,
    query: { enabled: canRun && ids.length > 0 },
  });

  useEffect(() => {
    if (canRun) {
      void ownerPlots.refetch();
      void batch.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const plots = (batch.data as readonly Plot[] | undefined) ?? [];

  let imageUri: string | null = null;
  let link: string | null = null;
  if (canRun && x != null && y != null) {
    for (const p of plots) {
      if (!p?.imageUri) continue;
      const z = parseZone(p.imageUri);
      if (!z) continue;
      if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) {
        imageUri = p.imageUri;
        link = parseLink(p.imageUri);
        break;
      }
    }
  }

  return { imageUri, link };
}

export function useBaseBoardWrite() {
  const bumpRefresh = useBoardStore((s) => s.bumpRefresh);
  const { connector } = useAccount();
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

  type WriteAsync = typeof writeContractAsync;
  const writeContractAsyncGuarded = useCallback<WriteAsync>(
    ((variables, options) => {
      // Pin every write to the *active* chain (Base or Celo) so transactions
      // always land on the network whose contract the UI is reading from.
      const cfg = getChainConfig(chainId) ?? DEFAULT_CHAIN_CONFIG;
      const targetChainId = cfg.chainId;
      const targetChain = viemChainFor(targetChainId);

      const doWrite = () =>
        writeContractAsync(
          { ...variables, chainId: targetChainId, chain: targetChain },
          options,
        );

      const ensureChainAndWrite = async () => {
        if (connector) {
          const provider = (await connector.getProvider()) as {
            request: (args: {
              method: string;
              params?: unknown[];
            }) => Promise<unknown>;
          };
          const rawId = (await provider.request({
            method: "eth_chainId",
          })) as string;
          const realChainId = parseInt(rawId, 16);
          if (realChainId !== targetChainId) {
            const hexChainId = `0x${targetChainId.toString(16)}`;
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
                  params: [
                    {
                      chainId: hexChainId,
                      chainName: cfg.name,
                      nativeCurrency: {
                        name: cfg.nativeSymbol,
                        symbol: cfg.nativeSymbol,
                        decimals: 18,
                      },
                      rpcUrls: [cfg.rpcUrl],
                      blockExplorerUrls: cfg.explorer ? [cfg.explorer] : [],
                    },
                  ],
                });
              } else {
                throw new Error(
                  `Please switch to ${cfg.name} in your wallet to continue.`,
                );
              }
            }
          }
        }
        return doWrite();
      };

      return ensureChainAndWrite();
    }) as WriteAsync,
    [writeContractAsync, connector, chainId],
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
