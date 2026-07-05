"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import { useBaseBoardWrite } from "@/hooks/useBaseBoard";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { baseBoardAbi, readContractWithTimeout } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/constants";
import {
  bboxToPlotIds,
  normalizeBBox,
  xyFromPlotId,
} from "@/lib/coords";
import { formatEther } from "viem";
import type { Plot } from "@/lib/types";

// Protocol-enforced per-tx gas cap (EIP-7825, Base Azul) is 16,777,216 gas.
// buyPlots costs ~68k gas/plot — max safe is 246. Set to 240 for buffer.
// Large purchases are split into sequential batches of up to this many plots.
// EIP-5792 wallet_sendCalls batching (single-signature multi-tx) was evaluated
// and deferred: it only benefits Coinbase Smart Wallet users, doesn't remove
// the 240-per-call gas limit, and requires ~2× the code with two parallel
// status-tracking paths. The sequential approach works for 100% of wallets.
// See session docs (2026-07-05) for the full tradeoff analysis.
const MAX_BUY = 240;

export function BuyModal() {
  const buySelection = useBoardStore((s) => s.buySelection);
  const clearBuySelection = useBoardStore((s) => s.clearBuySelection);
  const directBuyIds = useBoardStore((s) => s.directBuyIds);
  const setDirectBuyIds = useBoardStore((s) => s.setDirectBuyIds);
  const clearBasket = useBoardStore((s) => s.clearBasket);
  const applyOptimisticPlots = useBoardStore((s) => s.applyOptimisticPlots);
  const clearOptimisticPlots = useBoardStore((s) => s.clearOptimisticPlots);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const cfg = useActiveChainConfig();
  const { writeContractAsync, setPendingTxLabel, status, error, reset } =
    useBaseBoardWrite();

  const [buyableIds, setBuyableIds] = useState<number[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    done: boolean;
  } | null>(null);
  const batchBuyingRef = useRef(false);

  const open = buySelection != null || directBuyIds != null;
  const box = useMemo(
    () => (buySelection ? normalizeBBox(buySelection) : null),
    [buySelection],
  );

  // Unified list of selected plot ids — from a marquee box or the tap basket.
  const selectedIds = useMemo(() => {
    if (directBuyIds) return Array.from(new Set(directBuyIds));
    if (box) return bboxToPlotIds(box);
    return [];
  }, [directBuyIds, box]);

  const totalCount = selectedIds.length;
  const needsBatch = totalCount > MAX_BUY;
  const isSingle = totalCount === 1;
  const idsKey = selectedIds.join(",");

  // Determine which selected plots are actually unowned (buyable).
  useEffect(() => {
    setBuyableIds(null);
    setTxError(null);
    reset();
    if (!open || selectedIds.length === 0) return;
    const ids = selectedIds;

    if (!cfg.isConfigured || !publicClient) {
      setBuyableIds(ids); // demo mode: treat all as buyable
      return;
    }

    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const result = (await readContractWithTimeout(
          publicClient.readContract({
            address: cfg.contract,
            abi: baseBoardAbi,
            functionName: "getPlotsBatch",
            args: [ids.map((i) => BigInt(i))],
          }),
        )) as readonly Plot[];
        if (cancelled) return;
        const free = ids.filter(
          (_, i) => result[i].owner.toLowerCase() === ZERO_ADDRESS,
        );
        setBuyableIds(free);
      } catch {
        if (!cancelled) setBuyableIds(ids);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  const buyCount = buyableIds?.length ?? 0;

  // Chunked purchase: split buyableIds into ≤MAX_BUY batches and process
  // sequentially, so any selection (contiguous marquee or scattered basket)
  // is bought without hitting the per-tx gas cap. Each batch prompts the
  // wallet once. If any batch fails, stop and report clearly which succeeded.
  const onBuy = async () => {
    if (!buyableIds || buyableIds.length === 0 || !address) return;
    setTxError(null);
    batchBuyingRef.current = true;

    const chunks: number[][] = [];
    for (let i = 0; i < buyableIds.length; i += MAX_BUY) {
      chunks.push(buyableIds.slice(i, i + MAX_BUY));
    }

    const boughtIds: number[] = [];
    let failed = false;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setBatchProgress({ current: i + 1, total: chunks.length, done: false });
      setPendingTxLabel(`Purchase batch ${i + 1} of ${chunks.length}`);

      try {
        const hash = await writeContractAsync({
          address: cfg.contract,
          abi: baseBoardAbi,
          functionName: "buyPlots",
          args: [chunk.map((id) => BigInt(id))],
          value: cfg.plotPriceWei * BigInt(chunk.length),
        });

        if (hash && publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }

        boughtIds.push(...chunk);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Transaction failed";
        const succeeded = i;
        const remaining = chunks.length - i - 1;
        setTxError(
          `Batch ${i + 1} of ${chunks.length} failed.` +
            (succeeded > 0
              ? ` ${succeeded} batch(es) bought successfully.`
              : "") +
            (remaining > 0
              ? ` ${remaining} batch(es) not attempted.`
              : "") +
            ` Error: ${msg}`,
        );
        failed = true;
        break;
      }
    }

    batchBuyingRef.current = false;
    setBatchProgress(failed ? null : { current: chunks.length, total: chunks.length, done: true });

    if (!failed && boughtIds.length > 0) {
      const overrides: Record<number, Plot> = {};
      for (const id of boughtIds) {
        overrides[id] = {
          owner: address,
          price: 0n,
          isForSale: false,
          imageUri: "",
        };
      }
      applyOptimisticPlots(overrides);
      clearBasket();
    }
  };

  // Optimistically flip just-bought plots to "mine" the moment the tx confirms
  // so the board updates instantly instead of waiting for the next poll.
  // Guarded by batchBuyingRef so multi-batch purchases handle their own
  // optimistic updates in the sequential loop above.
  useEffect(() => {
    if (batchBuyingRef.current) return;
    if (status !== "success" || !address || !buyableIds || buyableIds.length === 0)
      return;
    const overrides: Record<number, Plot> = {};
    for (const id of buyableIds) {
      overrides[id] = {
        owner: address,
        price: 0n,
        isForSale: false,
        imageUri: "",
      };
    }
    applyOptimisticPlots(overrides);
    clearBasket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const close = () => {
    reset();
    setTxError(null);
    clearBuySelection();
    setDirectBuyIds(null);
    // Keep optimistic overrides after a successful buy so the plot reads as
    // owned instantly on the next click; only clear them when nothing was
    // purchased. Real on-chain reads overwrite them shortly after.
    if (status !== "success") clearOptimisticPlots();
  };

  const busy = status === "pending" || status === "confirming";

  return (
    <Modal
      open={open}
      onClose={close}
      title={isSingle ? "Buy Pixel" : "Buy Pixels"}
    >
      {open && (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-3 text-sm">
            {isSingle ? (
              <p className="font-semibold text-base-blue">
                Pixel ({xyFromPlotId(selectedIds[0]).x},{" "}
                {xyFromPlotId(selectedIds[0]).y}) · id #{selectedIds[0]}
              </p>
            ) : box ? (
              <p className="font-semibold text-base-blue">
                Region ({box.x1}, {box.y1}) → ({box.x2}, {box.y2})
              </p>
            ) : (
              <p className="font-semibold text-base-blue">
                Basket selection · {totalCount.toLocaleString()} pixels
              </p>
            )}
            <p className="mt-1 text-slate-600">
              {totalCount.toLocaleString()} pixels selected ·{" "}
              {cfg.plotPriceLabel} {cfg.nativeSymbol} each
            </p>
          </div>

          {checking || buyableIds === null ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Checking availability…
            </div>
          ) : buyCount === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              All selected pixels are already owned. Click an individual owned
              pixel to make an offer instead.
            </p>
          ) : (
            <div className="flex items-center justify-between rounded-xl border-2 border-base-blue px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Available to buy
                </p>
                <p className="text-lg font-black text-base-blue">
                  {buyCount.toLocaleString()} pixels
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Total
                </p>
                <p className="text-lg font-black text-base-blue">
                  {formatEther(cfg.plotPriceWei * BigInt(buyCount))}{" "}
                  {cfg.nativeSymbol}
                </p>
              </div>
            </div>
          )}

          {buyCount < totalCount && buyCount > 0 && (
            <p className="text-xs text-slate-500">
              {(totalCount - buyCount).toLocaleString()} pixel(s) in this region
              are already owned and were excluded.
            </p>
          )}

          {status === "success" && (
            <p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">
              Purchase confirmed! Your pixels are now on the board.
            </p>
          )}
          {(txError || error) && status !== "success" && (
            <p className="break-words rounded-lg bg-red-50 p-3 text-xs text-red-600">
              {txError || error?.message}
            </p>
          )}

          {!isConnected ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-slate-500">
                Connect a wallet to buy.
              </p>
              <WalletConnect />
            </div>
          ) : batchProgress?.done ? (
            <button
              type="button"
              onClick={close}
              className="w-full rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark"
            >
              Done — All {batchProgress.total} batches confirmed
            </button>
          ) : (
            <button
              type="button"
              onClick={onBuy}
              disabled={busy || buyCount === 0 || checking}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark disabled:opacity-50"
            >
              {busy && <Spinner size={16} className="!border-white/40 !border-t-white" />}
              {batchProgress
                ? status === "pending"
                  ? `Confirm batch ${batchProgress.current} of ${batchProgress.total} in wallet…`
                  : status === "confirming"
                    ? `Buying batch ${batchProgress.current} of ${batchProgress.total}…`
                    : `Buying batch ${batchProgress.current} of ${batchProgress.total}…`
                : status === "pending"
                  ? "Confirm in wallet…"
                  : status === "confirming"
                    ? "Minting…"
                    : needsBatch
                      ? `Buy ${buyCount > 0 ? buyCount : ""} pixels in ${Math.ceil(buyCount / MAX_BUY)} transactions`
                      : `Buy ${buyCount > 0 ? buyCount : ""} ${
                          buyCount === 1 ? "pixel" : "pixels"
                        }`}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
