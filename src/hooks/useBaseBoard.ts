"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // Try Turso API cache first for instant paint; RPC stays enabled in the
  // background so every new purchase instantly updates the displayed count.
  const [cachedSold, setCachedSold] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data: { sold?: number | null; available?: boolean }) => {
        if (!cancelled && data.available && data.sold != null) {
          setCachedSold(data.sold);
        }
      })
      .catch(() => {
        /* ignore — fall through to RPC */
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.contract]);

  const tursoSold = cachedSold;

  // RPC read is ALWAYS enabled: on first load Turso paints quickly, then RPC
  // refines the value. After a purchase the PlotsPurchased watcher refetches so
  // the counter never stalls behind the indexer.
  const { data, refetch, isLoading } = useReadContract({
    ...sharedReadConfig,
    functionName: "totalPlotsSold",
    query: {
      enabled: cfg.isConfigured,
      refetchInterval: 60_000,
    },
  });

  // Watch for any new purchase and refetch RPC immediately.
  useWatchContractEvent({
    ...sharedReadConfig,
    eventName: "PlotsPurchased",
    enabled: cfg.isConfigured,
    onLogs: () => {
      void refetch();
    },
  });

  // Prefer the freshest on-chain value when it's available; use Turso only as an
  // initial paint optimisation so the dashboard never reads 0 on first render.
  const onchain = cfg.isConfigured && data != null ? Number(data) : null;
  const sold = onchain ?? tursoSold ?? 0;
  const remaining = Math.max(0, DISPLAY_MAX_PLOTS - sold);

  return { sold, remaining, isLoading: isLoading && sold === 0, refetch };
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

  // A lagging / load-balanced public RPC node sometimes returns a stale
  // zero-owner read for a plot we already know (optimistically) to be owned.
  // Don't let that stale read override known-good local state: when the fresh
  // on-chain read says ZERO_ADDRESS but an override shows a real owner, keep
  // the override (it wins even after `onchain` has resolved, not only before).
  const overrideOwned =
    !!override && override.owner.toLowerCase() !== ZERO_ADDRESS;
  const onchainZero =
    !!onchain && onchain.owner.toLowerCase() === ZERO_ADDRESS;
  const staleZeroConflict = overrideOwned && onchainZero;

  // If the fresh read contradicts a known-good override by claiming the plot is
  // unowned, don't accept that first read — schedule one more refetch after a
  // short delay to give the lagging node a chance to catch up.
  useEffect(() => {
    if (!enabled || !staleZeroConflict) return;
    const t = setTimeout(() => void query.refetch(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staleZeroConflict]);

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
  /**
   * True when one or more `eth_getLogs` chunks failed every retry, so the
   * discovery scan is missing that block range's purchases (the result is a
   * best-effort partial rather than a complete history).
   */
  scanIncomplete?: boolean;
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

/**
 * Pure ranking builder: given the raw purchase log and current owner counts,
 * replay purchases chronologically for the tie-break key, then sort by count
 * (desc) with earlier-block wins. Kept pure (no hooks) so the leaderboard can
 * memoize it and run the sort/tie-break exactly once per fresh data batch
 * instead of on every render.
 */
function buildRanking(
  purchases: readonly PurchaseEvent[],
  counts: ReadonlyArray<readonly [string, number]>,
): LeaderEntry[] {
  const currentCounts = new Map(counts);

  // Tie-break: replay purchases in chronological (block) order, tracking each
  // buyer's running purchased total; record the block at which that running
  // total first reaches the buyer's *current* owned count.
  const chronological = [...purchases].sort((a, b) => a.block - b.block);
  const runningTotal = new Map<string, number>();
  const tieBreak = new Map<string, number>();
  const lastPurchaseBlock = new Map<string, number>();
  for (const p of chronological) {
    lastPurchaseBlock.set(p.buyer, p.block);
    const next = (runningTotal.get(p.buyer) ?? 0) + p.count;
    runningTotal.set(p.buyer, next);
    const target = currentCounts.get(p.buyer);
    if (target != null && next >= target && !tieBreak.has(p.buyer)) {
      tieBreak.set(p.buyer, p.block);
    }
  }

  return Array.from(currentCounts.entries())
    .map(([owner, count]) => ({
      owner: owner as `0x${string}`,
      count,
      // Fall back to the owner's last purchase block when the running total
      // never reached their current count (e.g. acquired via resale).
      tieBreakBlock:
        tieBreak.get(owner) ??
        lastPurchaseBlock.get(owner) ??
        Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.tieBreakBlock - b.tieBreakBlock,
    )
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Snapshot of a completed scan persisted to `sessionStorage` so a mid-session
 * page reload can hydrate the leaderboard/ticker instantly and resume the
 * incremental scan from `lastScannedBlock` instead of re-walking the full
 * history from `cfg.deployBlock`. Plain JSON — no extra state dependency.
 */
interface PersistedScan {
  lastScannedBlock: number;
  purchases: PurchaseEvent[];
  mintedIds: number[];
  counts: Array<[string, number]>;
}

function scanCacheKey(contract?: string): string | null {
  return contract ? `baseboard:scan:${contract.toLowerCase()}` : null;
}

function loadPersistedScan(contract?: string): PersistedScan | null {
  if (typeof window === "undefined") return null;
  const key = scanCacheKey(contract);
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedScan;
    if (
      !parsed ||
      typeof parsed.lastScannedBlock !== "number" ||
      !Array.isArray(parsed.purchases) ||
      !Array.isArray(parsed.mintedIds) ||
      !Array.isArray(parsed.counts)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedScan(contract: string | undefined, snap: PersistedScan) {
  if (typeof window === "undefined") return;
  const key = scanCacheKey(contract);
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snap));
  } catch {
    /* quota exceeded / serialization error — caching is best-effort, skip */
  }
}

export function useAllMintedPlots(): AllMintedData {
  const cfg = useActiveChainConfig();
  const publicClient = usePublicClient();
  const refreshNonce = useBoardStore((s) => s.refreshNonce);

  // Try Turso API cache first; fall back to RPC scan on failure.
  const [cachedData, setCachedData] = useState<{
    ranking: LeaderEntry[];
    events: PurchaseEvent[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data: { ranking?: LeaderEntry[]; events?: PurchaseEvent[]; fromCache?: boolean }) => {
        if (!cancelled && data.fromCache && data.ranking && data.events) {
          setCachedData({ ranking: data.ranking, events: data.events });
        }
      })
      .catch(() => {
        /* ignore — fall through to RPC */
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.contract]);

  // When Turso cached data is already loaded, skip the expensive RPC scan and
  // present the cached leaderboard/ticker directly. The RPC scan still runs when
  // the nonce bumps (user tx) or the cache wasn't reachable.
  const hasCache = cachedData != null;

  // Raw, *unsorted* scan output held in state. It is replaced only when a fresh
  // on-chain batch fully resolves (a "state lock") — the derived leaderboard
  // therefore never re-orders due to incidental background re-renders, only when
  // genuinely new plot data arrives.
  const [raw, setRaw] = useState<{
    loading: boolean;
    purchases: PurchaseEvent[];
    counts: Array<[string, number]>;
    scanIncomplete?: boolean;
  }>({ loading: false, purchases: [], counts: [] });

  // Live refresh: re-scan whenever a `PlotsPurchased` event lands (anyone's
  // purchase, not just the local wallet's) and on a slow safety interval, so the
  // leaderboard ranking and activity ticker reflect real-time on-chain status.
  const [liveTick, setLiveTick] = useState(0);

  useWatchContractEvent({
    address: cfg.contract,
    abi: baseBoardAbi,
    eventName: "PlotsPurchased",
    enabled: cfg.isConfigured,
    onLogs: () => setLiveTick((t) => t + 1),
  });

  useEffect(() => {
    if (!cfg.isConfigured) return;
    const id = setInterval(() => setLiveTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [cfg.isConfigured]);

  const runningRef = useRef(false);

  // Persisted, incremental discovery state scoped to the active contract. Each
  // trigger only reads NEW logs (lastScannedBlock+1 .. latest) and merges them
  // into the accumulated purchases/mintedIds, instead of re-scanning the whole
  // history from the deploy block every time (which made owner counts unstable).
  // Hydrated synchronously from the sessionStorage snapshot so a mid-session
  // reload resumes the scan from the persisted block, not the deploy block —
  // only a true first-ever visit (empty cache) pays the full historical scan.
  const scanStateRef = useRef<{
    contract: string | undefined;
    lastScannedBlock: number;
    purchases: PurchaseEvent[];
    mintedIds: Set<number>;
  } | null>(null);
  if (scanStateRef.current === null) {
    const snap = loadPersistedScan(cfg.contract);
    scanStateRef.current = snap
      ? {
          contract: cfg.contract,
          lastScannedBlock: snap.lastScannedBlock,
          purchases: snap.purchases,
          mintedIds: new Set(snap.mintedIds),
        }
      : {
          contract: undefined,
          lastScannedBlock: 0,
          purchases: [],
          mintedIds: new Set(),
        };
  }

  // One-time hydration of the displayed data from the persisted snapshot so a
  // mid-session reload paints the last-known ranking/ticker immediately while
  // the incremental scan below refreshes it in the background.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const snap = loadPersistedScan(cfg.contract);
    if (snap && (snap.purchases.length > 0 || snap.counts.length > 0)) {
      setRaw({ loading: false, purchases: snap.purchases, counts: snap.counts });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cfg.isConfigured || !publicClient) {
      scanStateRef.current = {
        contract: undefined,
        lastScannedBlock: 0,
        purchases: [],
        mintedIds: new Set(),
      };
      setRaw({ loading: false, purchases: [], counts: [], scanIncomplete: false });
      return;
    }
    let cancelled = false;
    if (runningRef.current) return;
    runningRef.current = true;
    setRaw((d) => ({ ...d, loading: true }));

    (async () => {
      try {
        const latest = Number(await publicClient.getBlockNumber());

        // Reset the accumulator when the active contract changes.
        const st = scanStateRef.current ?? {
          contract: undefined,
          lastScannedBlock: 0,
          purchases: [] as PurchaseEvent[],
          mintedIds: new Set<number>(),
        };
        scanStateRef.current = st;
        if (st.contract !== cfg.contract) {
          st.contract = cfg.contract;
          st.lastScannedBlock = 0;
          st.purchases = [];
          st.mintedIds = new Set();
        }

        // Incremental: first pass scans from the deploy block; later passes only
        // scan the blocks added since the last successfully-scanned one.
        const fromBlock =
          st.lastScannedBlock > 0 ? st.lastScannedBlock + 1 : cfg.deployBlock;

        let scanIncomplete = false;
        const LOG_CHUNK = 9_500;
        for (let start = fromBlock; start <= latest; start += LOG_CHUNK + 1) {
          const end = Math.min(start + LOG_CHUNK, latest);
          let ok = false;
          // Retry a failed range up to 3 times with 500/1000/2000ms backoff
          // before giving up on it — avoids silently dropping its purchases.
          for (let attempt = 0; attempt < 3 && !ok; attempt++) {
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
                args.plotIds.forEach((b) => st.mintedIds.add(Number(b)));
                st.purchases.push({
                  buyer: args.buyer.toLowerCase() as `0x${string}`,
                  count: args.plotIds.length,
                  block: Number(log.blockNumber ?? 0n),
                  txHash: log.transactionHash ?? "",
                });
              });
              ok = true;
            } catch {
              if (attempt < 2)
                await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
            }
          }
          // A range that failed every retry leaves a hole; flag it rather than
          // treating the partial result as a complete history.
          if (!ok) scanIncomplete = true;
        }

        // Advance the cursor even on a partial pass so ranges that succeeded are
        // not re-read on the next trigger.
        st.lastScannedBlock = latest;

        // Ownership (accounts for resales) is read over the FULL accumulated id
        // set every pass, since a resale can change ownership of an already-
        // discovered plot id — only discovery is incremental, not this read.
        const all = Array.from(st.mintedIds);
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

        // Hand the raw batch to state; sorting/tie-break happens once in the
        // memo below, not here and not on every render.
        const counts = Array.from(currentCounts.entries());

        // Persist the snapshot so the next reload hydrates instantly and the
        // scan resumes from `lastScannedBlock` rather than the deploy block.
        savePersistedScan(cfg.contract, {
          lastScannedBlock: st.lastScannedBlock,
          purchases: st.purchases,
          mintedIds: Array.from(st.mintedIds),
          counts,
        });

        if (!cancelled)
          setRaw({
            loading: false,
            purchases: [...st.purchases],
            counts,
            scanIncomplete,
          });
      } catch {
        if (!cancelled) setRaw((d) => ({ ...d, loading: false }));
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
    liveTick,
  ]);

  // Sort + tie-break ONCE per fresh batch: these memos only recompute when the
  // underlying raw arrays' identity changes (i.e. a new scan landed), so a mere
  // `loading` flip or any incidental re-render reuses the previous sorted array
  // and the leaderboard never "jumps".
  const ranking = useMemo(
    () => buildRanking(raw.purchases, raw.counts),
    [raw.purchases, raw.counts],
  );
  const events = useMemo(
    () => [...raw.purchases].sort((a, b) => b.block - a.block).slice(0, 20),
    [raw.purchases],
  );

  // Use Turso cached data for instant initial paint; once the RPC scan lands
  // (raw has data), prefer the live on-chain data over the cached snapshot.
  const useRpc = raw.purchases.length > 0;

  return {
    loading: raw.loading && !useRpc,
    ranking: useRpc ? ranking : cachedData?.ranking ?? ranking,
    events: useRpc ? events : cachedData?.events ?? events,
    scanIncomplete: useRpc ? raw.scanIncomplete : false,
  };
}
