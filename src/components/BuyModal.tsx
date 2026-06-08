"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import { useBaseBoardWrite } from "@/hooks/useBaseBoard";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import {
  IS_CONTRACT_CONFIGURED,
  PLOT_PRICE_ETH,
  ZERO_ADDRESS,
} from "@/lib/constants";
import {
  bboxPlotCount,
  bboxToPlotIds,
  normalizeBBox,
  plotIdFromXY,
  totalPriceEth,
  totalPriceWei,
} from "@/lib/coords";
import type { Plot } from "@/lib/types";

const MAX_BUY = 400;

export function BuyModal() {
  const buySelection = useBoardStore((s) => s.buySelection);
  const clearBuySelection = useBoardStore((s) => s.clearBuySelection);
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, status, error, reset } = useBaseBoardWrite();

  const [buyableIds, setBuyableIds] = useState<number[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const open = buySelection != null;
  const box = useMemo(
    () => (buySelection ? normalizeBBox(buySelection) : null),
    [buySelection],
  );
  const totalCount = box ? bboxPlotCount(box) : 0;
  const tooLarge = totalCount > MAX_BUY;
  const isSingle = totalCount === 1;

  // Determine which selected plots are actually unowned (buyable).
  useEffect(() => {
    setBuyableIds(null);
    setTxError(null);
    reset();
    if (!open || !box || tooLarge) return;
    const ids = bboxToPlotIds(box);

    if (!IS_CONTRACT_CONFIGURED || !publicClient) {
      setBuyableIds(ids); // demo mode: treat all as buyable
      return;
    }

    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const result = (await publicClient.readContract({
          address: baseBoardAddress,
          abi: baseBoardAbi,
          functionName: "getPlotsBatch",
          args: [ids.map((i) => BigInt(i))],
        })) as readonly Plot[];
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
  }, [open, box?.x1, box?.y1, box?.x2, box?.y2, tooLarge]);

  const buyCount = buyableIds?.length ?? 0;

  const onBuy = async () => {
    if (!buyableIds || buyableIds.length === 0) return;
    setTxError(null);
    try {
      await writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "buyPlots",
        args: [buyableIds.map((i) => BigInt(i))],
        value: totalPriceWei(buyableIds.length),
      });
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Transaction failed");
    }
  };

  const close = () => {
    reset();
    setTxError(null);
    clearBuySelection();
  };

  const busy = status === "pending" || status === "confirming";

  return (
    <Modal
      open={open}
      onClose={close}
      title={isSingle ? "Buy Plot" : "Buy Plots"}
    >
      {box && (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-3 text-sm">
            {isSingle ? (
              <p className="font-semibold text-base-blue">
                Plot ({box.x1}, {box.y1}) · id #{plotIdFromXY(box.x1, box.y1)}
              </p>
            ) : (
              <p className="font-semibold text-base-blue">
                Region ({box.x1}, {box.y1}) → ({box.x2}, {box.y2})
              </p>
            )}
            <p className="mt-1 text-slate-600">
              {totalCount.toLocaleString()} plots selected · {PLOT_PRICE_ETH} ETH
              each
            </p>
          </div>

          {tooLarge ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Selection too large. You can buy up to {MAX_BUY} plots per
              transaction — please select a smaller region.
            </p>
          ) : checking || buyableIds === null ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Checking availability…
            </div>
          ) : buyCount === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              All selected plots are already owned. Click an individual owned
              plot to make an offer instead.
            </p>
          ) : (
            <div className="flex items-center justify-between rounded-xl border-2 border-base-blue px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Available to buy
                </p>
                <p className="text-lg font-black text-base-blue">
                  {buyCount.toLocaleString()} plots
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Total
                </p>
                <p className="text-lg font-black text-base-blue">
                  {totalPriceEth(buyCount)} ETH
                </p>
              </div>
            </div>
          )}

          {buyCount < totalCount && buyCount > 0 && !tooLarge && (
            <p className="text-xs text-slate-500">
              {(totalCount - buyCount).toLocaleString()} plot(s) in this region
              are already owned and were excluded.
            </p>
          )}

          {status === "success" && (
            <p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">
              Purchase confirmed! Your plots are now on the board.
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
                      buyCount === 1 ? "plot" : "plots"
                    }`}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
