"use client";

import { useState, useEffect } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import {
  useOffer,
  useBaseBoardWrite,
} from "@/hooks/useBaseBoard";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { baseBoardAbi } from "@/lib/contract";
import { shortAddress, xyFromPlotId } from "@/lib/coords";
import { parseLink, stripZone } from "@/lib/image";
import { ZERO_ADDRESS } from "@/lib/constants";
import type { Plot } from "@/lib/types";
import { fetchTursoBoard } from "@/lib/tursoClient";

export function PlotModal() {
  const activePlotId = useBoardStore((s) => s.activePlotId);
  const closePlot = useBoardStore((s) => s.closePlot);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const { address, isConnected } = useAccount();

  const cfg = useActiveChainConfig();
  const { data: myOfferRaw } = useOffer(activePlotId, address);
  const { writeContractAsync, status, error, reset } = useBaseBoardWrite();

  const [offerEth, setOfferEth] = useState("");
  const [txError, setTxError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Turso-only data (no RPC reads)
  const [tursoPlot, setTursoPlot] = useState<Plot | null | "loading">("loading");

  useEffect(() => {
    if (activePlotId == null) return;
    setTursoPlot("loading");
    let cancelled = false;
    fetchTursoBoard([activePlotId]).then((res) => {
      if (cancelled) return;
      const p = res?.plots?.[activePlotId] ?? null;
      setTursoPlot(p);
    });
    return () => { cancelled = true; };
  }, [activePlotId]);

  // Sync Turso data back to the canvas so image URI changes are reflected
  // on the board (push via optimistic overrides).
  useEffect(() => {
    if (activePlotId == null || !tursoPlot || tursoPlot === "loading") return;
    useBoardStore.getState().applyOptimisticPlots({ [activePlotId]: tursoPlot });
  }, [tursoPlot, activePlotId]);

  const loading = tursoPlot === "loading";
  const effectivePlot: Plot | null = tursoPlot && tursoPlot !== "loading" ? tursoPlot : null;
  const effectiveOwned = !!effectivePlot && effectivePlot.owner.toLowerCase() !== ZERO_ADDRESS;

  const open = activePlotId != null;
  const coords = activePlotId != null ? xyFromPlotId(activePlotId) : null;
  const myOffer = (myOfferRaw as bigint | undefined) ?? 0n;

  // The plot's own image/link
  const ownImage = effectivePlot?.imageUri ? stripZone(effectivePlot.imageUri) : null;
  const ownLink = effectivePlot?.imageUri ? parseLink(effectivePlot.imageUri) : null;
  const displayImage = ownImage;
  const plotLink = ownLink;

  const isOwner =
    !!effectivePlot &&
    !!address &&
    effectivePlot.owner.toLowerCase() === address.toLowerCase();
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
        value: effectivePlot!.price,
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

  const pixelShareUrl = () =>
    typeof window !== "undefined"
      ? `${window.location.origin}/?pixel=${activePlotId}`
      : "";

  const onShareX = () => {
    const text = "I just claimed my spot on BaseBoard \u{1F7E6} #Base @base";
    const url = pixelShareUrl();
    const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(
      text,
    )}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  };

  const onCopyLink = async () => {
    const url = pixelShareUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch { /* clipboard unavailable */ }
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

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

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Loading pixel…
            </div>
          ) : !effectiveOwned ? (
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
                    {isOwner ? "You" : shortAddress(effectivePlot?.owner)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-semibold text-slate-800">
                    {effectivePlot?.isForSale ? (
                      <span className="text-green-600">For sale</span>
                    ) : (
                      <span className="text-slate-500">Not for sale</span>
                    )}
                  </dd>
                </div>
                {effectivePlot?.isForSale && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Asking price</dt>
                    <dd className="font-black text-base-blue">
                      {formatEther(effectivePlot.price)} ETH
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

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onShareX}
                  className="flex-1 rounded-lg border-2 border-base-blue py-2 text-sm font-semibold text-base-blue hover:bg-blue-50"
                >
                  Share on X
                </button>
                <button
                  type="button"
                  onClick={onCopyLink}
                  className="flex-1 rounded-lg border-2 border-base-blue py-2 text-sm font-semibold text-base-blue hover:bg-blue-50"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>

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
                  {effectivePlot?.isForSale && (
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
                      Buy Now · {effectivePlot ? formatEther(effectivePlot.price) : "0"} ETH
                    </button>
                  )}

                  <div className="rounded-xl border-2 border-blue-100 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-700">
                      {effectivePlot?.isForSale
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
