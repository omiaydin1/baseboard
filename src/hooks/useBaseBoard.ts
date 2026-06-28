"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { base, hardhat } from "viem/chains";
import type { Chain } from "viem";
import { baseBoardAbi, readContractWithTimeout } from "@/lib/contract";
import {
  DEFAULT_CHAIN_CONFIG,
  DISPLAY_MAX_PLOTS,
  getChainConfig,
  ZERO_ADDRESS,
} from "@/lib/constants";
import { useActiveChainConfig } from "./useActiveContract";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";
import { resolveCoveringImage } from "@/lib/image";
import { clearPendingTx, savePendingTx } from "@/lib/pendingTx";

/** viem chain object for a given chain id (for pinning write transactions). */
function viemChainFor(chainId: number): Chain {
  switch (chainId) {
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
  const { refreshNonce, optimisticPlots } = useBoardStore();
  const cfg = useActiveChainConfig();
  const sharedReadConfig = { address: cfg.contract, abi: baseBoardAbi } as const;
  const enabled = cfg.isConfigured && plotId != null;

  const query = useReadContract({
    ...sharedReadConfig,
    functionName: "getPlot",
    args: plotId != null ? [BigInt(plotId)] : undefined,
    // Always read fresh when a plot is inspected so a just-bought/updated plot
    // never shows the stale "unowned" state from a cached zero-owner read.
    // `refetchOnMount: "always"` + retry guard against load-balanced public RPC
    // nodes that occasionally lag a block and return a zero owner.
    query: {
      enabled,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      retry: 3,
      retryDelay: 400,
    },
  });

  // Force a fresh on-chain read on every refresh AND on every plot open (the
  // plotId changing), so the first click after a tx reliably reflects state.
  useEffect(() => {
    if (enabled) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce, plotId]);

  // Prefer an optimistic override (set the instant a tx confirms) so ownership
  // and image/link flip immediately on every click instead of after several
  // open/close cycles while the RPC node catches up.
  const onchain = query.data as Plot | undefined;
  const override = plotId != null ? optimisticPlots[plotId] : undefined;
  const plot = override ?? onchain;
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

  const covering =
    canRun && x != null && y != null
      ? resolveCoveringImage(plots, x, y)
      : null;

  return { imageUri: covering?.imageUri ?? null, link: covering?.link ?? null };
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

  // Human label for the in-flight tx, persisted alongside the hash so a webview
  // reload can recover and report the right outcome. Set via `setPendingTxLabel`.
  const pendingLabelRef = useRef("Transaction");
  const setPendingTxLabel = useCallback((label: string) => {
    pendingLabelRef.current = label;
  }, []);

  // Persist the pending tx hash for cross-reload recovery (BaseApp webview).
  useEffect(() => {
    if (hash)
      savePendingTx({ hash, chainId, label: pendingLabelRef.current });
  }, [hash, chainId]);

  useEffect(() => {
    if (isSuccess) {
      bumpRefresh();
      clearPendingTx();
    }
  }, [isSuccess, bumpRefresh]);

  useEffect(() => {
    if (error) clearPendingTx();
  }, [error]);

  type WriteAsync = typeof writeContractAsync;
  const writeContractAsyncGuarded = useCallback<WriteAsync>(
    ((variables, options) => {
      // Pin every write to the active chain (Base) so transactions always land
      // on the network whose contract the UI is reading from.
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
    setPendingTxLabel,
    hash,
    status,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

/** A single `PlotsPurchased` transaction, normalised for the activity ticker. */
export interface PurchaseEvent {
  buyer: `0x${string}`;
  /** Number of pixels bought in this one transaction (`plotIds.length`). */
  count: number;
  block: number;
  txHash: string;
}

/** One owner's standing in the leaderboard ranking. */
export interface LeaderEntry {
  owner: `0x${string}`;
  count: number;
  /**
   * Block at which this owner's running *purchased* total first reached their
   * current owned count — the leaderboard tie-break key (earlier ranks higher).
   */
  tieBreakBlock: number;
  rank: number;
}

export interface AllMintedData {
  loading: boolean;
  ranking: LeaderEntry[];
  /** Recent purchases, most-recent-first, for the activity ticker. */
  events: PurchaseEvent[];
}

/**
 * Shared on-chain data source for the leaderboard drawer and the activity
 * ticker. Uses the *same* scanning approach as `BaseBoardCanvas.tsx`'s
 * `loadAllMinted` — enumerate `PlotsPurchased` logs from the deploy block
 * (chunked under Base's 10k `eth_getLogs` range cap), then batch-read current
 * owner state via `getPlotsBatch` — so both features rank/display real on-chain
 * ownership with no off-chain database. Kept independent of the canvas's
 * imperative viewport loader so adding it cannot regress canvas rendering.
 *
 * Ranking: owners sorted by current pixel count descending. Ties are broken by
 * the block at which an owner's running purchased total first reached their
 * current count (NOT their first-ever purchase block) — computed by replaying
 * purchase events in chronological block order, exactly as specified.
 */
export function useAllMintedPlots(): AllMintedData {
  const cfg = useActiveChainConfig();
  const publicClient = usePublicClient();
  const refreshNonce = useBoardStore((s) => s.refreshNonce);

  const [data, setData] = useState<AllMintedData>({
    loading: false,
    ranking: [],
    events: [],
  });

  const runningRef = useRef(false);

  useEffect(() => {
    if (!cfg.isConfigured || !publicClient) {
      setData({ loading: false, ranking: [], events: [] });
      return;
    }
    let cancelled = false;
    if (runningRef.current) return;
    runningRef.current = true;
    setData((d) => ({ ...d, loading: true }));

    (async () => {
      try {
        const latest = Number(await publicClient.getBlockNumber());
        const purchases: PurchaseEvent[] = [];
        const mintedIds = new Set<number>();

        const LOG_CHUNK = 9_500;
        for (let start = cfg.deployBlock; start <= latest; start += LOG_CHUNK + 1) {
          const end = Math.min(start + LOG_CHUNK, latest);
          try {
            const logs = await publicClient.getContractEvents({
              address: cfg.contract,
              abi: baseBoardAbi,
              eventName: "PlotsPurchased",
              fromBlock: BigInt(start),
              toBlock: BigInt(end),
            });
            logs.forEach((log) => {
              const args = log.args as {
                buyer?: `0x${string}`;
                plotIds?: readonly bigint[];
              };
              if (!args.buyer || !args.plotIds) return;
              args.plotIds.forEach((b) => mintedIds.add(Number(b)));
              purchases.push({
                buyer: args.buyer.toLowerCase() as `0x${string}`,
                count: args.plotIds.length,
                block: Number(log.blockNumber ?? 0n),
                txHash: log.transactionHash ?? "",
              });
            });
          } catch {
            /* range rejected by RPC — skip this window, keep going */
          }
        }

        // Current ownership (accounts for resales) via chunked batch reads.
        const all = Array.from(mintedIds);
        const currentCounts = new Map<string, number>();
        const READ_CHUNK = 400;
        for (let i = 0; i < all.length; i += READ_CHUNK) {
          const slice = all.slice(i, i + READ_CHUNK);
          try {
            const res = (await readContractWithTimeout(
              publicClient.readContract({
                address: cfg.contract,
                abi: baseBoardAbi,
                functionName: "getPlotsBatch",
                args: [slice.map((n) => BigInt(n))],
              }),
            )) as readonly Plot[];
            res.forEach((plot) => {
              const owner = plot.owner.toLowerCase();
              if (owner === ZERO_ADDRESS) return;
              currentCounts.set(owner, (currentCounts.get(owner) ?? 0) + 1);
            });
          } catch {
            /* keep going with whatever loaded */
          }
        }

        // Tie-break: replay purchases in chronological (block) order, tracking
        // each buyer's running purchased total; record the block at which that
        // running total first reaches the buyer's *current* owned count.
        const chronological = [...purchases].sort((a, b) => a.block - b.block);
        const runningTotal = new Map<string, number>();
        const tieBreak = new Map<string, number>();
        const lastPurchaseBlock = new Map<string, number>();
        for (const p of chronological) {
          lastPurchaseBlock.set(p.buyer, p.block);
          const next = (runningTotal.get(p.buyer) ?? 0) + p.count;
          runningTotal.set(p.buyer, next);
          const target = currentCounts.get(p.buyer);
          if (
            target != null &&
            next >= target &&
            !tieBreak.has(p.buyer)
          ) {
            tieBreak.set(p.buyer, p.block);
          }
        }

        const ranking: LeaderEntry[] = Array.from(currentCounts.entries())
          .map(([owner, count]) => ({
            owner: owner as `0x${string}`,
            count,
            // Fall back to the owner's last purchase block when the running
            // total never reached their current count (e.g. acquired via resale).
            tieBreakBlock:
              tieBreak.get(owner) ?? lastPurchaseBlock.get(owner) ?? Number.MAX_SAFE_INTEGER,
          }))
          .sort((a, b) =>
            b.count !== a.count
              ? b.count - a.count
              : a.tieBreakBlock - b.tieBreakBlock,
          )
          .map((e, i) => ({ ...e, rank: i + 1 }));

        const events = [...purchases]
          .sort((a, b) => b.block - a.block)
          .slice(0, 20);

        if (!cancelled) setData({ loading: false, ranking, events });
      } catch {
        if (!cancelled) setData((d) => ({ ...d, loading: false }));
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
    };
  }, [
    cfg.isConfigured,
    cfg.contract,
    cfg.deployBlock,
    publicClient,
    refreshNonce,
  ]);

  return data;
}
