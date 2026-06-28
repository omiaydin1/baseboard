"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import {
  usePlot,
  useOffer,
  useBaseBoardWrite,
  useCoveringImage,
} from "@/hooks/useBaseBoard";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { baseBoardAbi } from "@/lib/contract";
import { shortAddress, xyFromPlotId } from "@/lib/coords";
import { parseLink, stripZone } from "@/lib/image";

export function PlotModal() {
  const activePlotId = useBoardStore((s) => s.activePlotId);
  const closePlot = useBoardStore((s) => s.closePlot);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const { address, isConnected } = useAccount();

  const cfg = useActiveChainConfig();
  const { plot, isOwned, isLoading } = usePlot(activePlotId);
  const { data: myOfferRaw } = useOffer(activePlotId, address);
  const { writeContractAsync, status, error, reset } = useBaseBoardWrite();

  const [offerEth, setOfferEth] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const open = activePlotId != null;
  const coords = activePlotId != null ? xyFromPlotId(activePlotId) : null;
  const myOffer = (myOfferRaw as bigint | undefined) ?? 0n;

  // The plot's own image/link (set when this plot is the anchor of an image).
  const ownImage = plot?.imageUri ? stripZone(plot.imageUri) : null;
  const ownLink = plot?.imageUri ? parseLink(plot.imageUri) : null;

  // A multi-plot image lives only on its anchor plot; any other covered pixel
  // carries no metadata. Resolve the spanning image/link covering this pixel so
  // clicking ANY pixel under a batch image shows the same destination link.
  const needCover = !!plot && !!coords && (!ownImage || !ownLink);
  const covering = useCoveringImage(
    plot?.owner,
    coords?.x ?? null,
    coords?.y ?? null,
    needCover,
  );
  const displayImage =
    ownImage || (covering.imageUri ? stripZone(covering.imageUri) : null);
  const plotLink = ownLink || covering.link;

  const isOwner =
    !!plot && !!address && plot.owner.toLowerCase() === address.toLowerCase();
  const busy = status === "pending" || status === "confirming";

  const run = async (fn: () => Promise<unknown>) => {
    setTxError(null);
    try {
      await fn();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Transaction failed");
    }
  };

  const onBuyNow = () =>
    run(() =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "buyListedPlot",
        args: [BigInt(activePlotId!)],
        value: plot!.price,
      }),
    );

  const onPlaceOffer = () => {
    let value: bigint;
    try {
      value = parseEther(offerEth || "0");
    } catch {
      setTxError("Invalid ETH amount");
      return;
    }
    if (value <= 0n) {
      setTxError("Enter an offer greater than 0");
      return;
    }
    return run(() =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "placeOffer",
        args: [BigInt(activePlotId!)],
        value,
      }),
    );
  };

  const onCancelOffer = () =>
    run(() =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "cancelOffer",
        args: [BigInt(activePlotId!)],
      }),
    );

  const close = () => {
    reset();
    setOfferEth("");
    setTxError(null);
    closePlot();
  };

  return (
    <Modal open={open} onClose={close} title="Pixel Details">
      {coords && (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-3 text-sm">
            <p className="font-semibold text-base-blue">
              Pixel ({coords.x}, {coords.y}) · id #{activePlotId}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Loading pixel…
            </div>
          ) : !isOwned ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              This pixel is unowned. Close and click it to buy.
            </p>
          ) : (
            <>
              {displayImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayImage}
                  alt="pixel artwork"
                  className="h-40 w-full rounded-xl border-2 border-blue-100 bg-slate-50 object-contain"
                />
              )}

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Owner</dt>
                  <dd className="font-mono font-semibold text-slate-800">
                    {isOwner ? "You" : shortAddress(plot?.owner)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-semibold text-slate-800">
                    {plot?.isForSale ? (
                      <span className="text-green-600">For sale</span>
                    ) : (
                      <span className="text-slate-500">Not for sale</span>
                    )}
                  </dd>
                </div>
                {plot?.isForSale && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Asking price</dt>
                    <dd className="font-black text-base-blue">
                      {formatEther(plot.price)} ETH
                    </dd>
                  </div>
                )}
                {plotLink && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Link</dt>
                    <dd className="min-w-0 text-right">
                      <a
                        href={plotLink}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="block truncate font-semibold text-base-blue hover:underline"
                      >
                        {plotLink}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {status === "success" ? (
                <p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">
                  Transaction confirmed!
                </p>
              ) : (txError || error) ? (
                <p className="break-words rounded-lg bg-red-50 p-3 text-xs text-red-600">
                  {txError || error?.message}
                </p>
              ) : null}

              {!isConnected ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-slate-500">
                    Connect a wallet to transact.
                  </p>
                  <WalletConnect />
                </div>
              ) : isOwner ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setProfileOpen(true);
                  }}
                  className="w-full rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark"
                >
                  Manage in My Profile →
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Buy Now (only when listed) */}
                  {plot?.isForSale && (
                    <button
                      type="button"
                      onClick={onBuyNow}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark disabled:opacity-50"
                    >
                      {busy && (
                        <Spinner
                          size={16}
                          className="!border-white/40 !border-t-white"
                        />
                      )}
                      Buy Now · {plot ? formatEther(plot.price) : "0"} ETH
                    </button>
                  )}

                  {/* Place / manage offer */}
                  <div className="rounded-xl border-2 border-blue-100 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-700">
                      {plot?.isForSale
                        ? "Or place an offer"
                        : "This plot isn't listed — place an offer"}
                    </p>
                    {myOffer > 0n && (
                      <p className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-base-blue">
                        Your active escrowed offer: {formatEther(myOffer)} ETH
                      </p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.00001"
                        value={offerEth}
                        onChange={(e) => setOfferEth(e.target.value)}
                        placeholder="0.001"
                        className="w-full rounded-lg border-2 border-blue-100 px-3 py-2 text-sm focus:border-base-blue focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={onPlaceOffer}
                        disabled={busy}
                        className="whitespace-nowrap rounded-lg bg-base-blue px-4 py-2 text-sm font-bold text-white hover:bg-base-dark disabled:opacity-50"
                      >
                        Place Offer
                      </button>
                    </div>
                    {myOffer > 0n && (
                      <button
                        type="button"
                        onClick={onCancelOffer}
                        disabled={busy}
                        className="mt-2 w-full rounded-lg border-2 border-red-200 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Withdraw my offer
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
