"use client";

import { useEffect, useMemo, useState } from "react";
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

const MAX_BUY = 5000;

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
  const tooLarge = totalCount > MAX_BUY;
  const isSingle = totalCount === 1;
  const idsKey = selectedIds.join(",");

  // Determine which selected plots are actually unowned (buyable).
  useEffect(() => {
    setBuyableIds(null);
    setTxError(null);
    reset();
    if (!open || selectedIds.length === 0 || tooLarge) return;
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
  }, [open, idsKey, tooLarge]);

  const buyCount = buyableIds?.length ?? 0;

  const onBuy = async () => {
    if (!buyableIds || buyableIds.length === 0) return;
    setTxError(null);
    setPendingTxLabel("Purchase");
    try {
      await writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "buyPlots",
        args: [buyableIds.map((i) => BigInt(i))],
        value: cfg.plotPriceWei * BigInt(buyableIds.length),
      });
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Transaction failed");
    }
  };

  // Optimistically flip just-bought plots to "mine" the moment the tx confirms
  // so the board updates instantly instead of waiting for the next poll.
  useEffect(() => {
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

          {tooLarge ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Selection too large. You can buy up to {MAX_BUY} pixels per
              transaction — please select a smaller region.
            </p>
          ) : checking || buyableIds === null ? (
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

          {buyCount < totalCount && buyCount > 0 && !tooLarge && (
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
          ) : status === "success" ? (
            <button
              type="button"
              onClick={close}
              className="w-full rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={onBuy}
              disabled={busy || buyCount === 0 || tooLarge || checking}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark disabled:opacity-50"
            >
              {busy && <Spinner size={16} className="!border-white/40 !border-t-white" />}
              {status === "pending"
                ? "Confirm in wallet…"
                : status === "confirming"
                  ? "Minting…"
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
