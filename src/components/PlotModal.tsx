"use client";

import { useState, useEffect } from "react";
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
import { ZERO_ADDRESS } from "@/lib/constants";
import type { Plot } from "@/lib/types";
import { fetchTursoBoard } from "@/lib/tursoClient";

export function PlotModal() {
  const activePlotId = useBoardStore((s) => s.activePlotId);
  const closePlot = useBoardStore((s) => s.closePlot);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const { address, isConnected } = useAccount();

  const cfg = useActiveChainConfig();
  const {
    plot: rpcPlot,
    isOwned: rpcOwned,
    isLoading: rpcLoading,
  } = usePlot(activePlotId);
  const { data: myOfferRaw } = useOffer(activePlotId, address);
  const { writeContractAsync, status, error, reset } = useBaseBoardWrite();

  const [offerEth, setOfferEth] = useState("");
  const [txError, setTxError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ---------------------------------------------------------------------------
  // Phase 2: Turso provisional + RPC authoritative
  //
  // Source-of-truth rule: RPC always wins over Turso when they conflict. Turso
  // is a fast preview layer only — it may lag behind the chain (indexer delay).
  // It provides instant display while RPC is in flight, but is never the final
  // word on ownership.
  //
  // States:
  //   "loading"        — both Turso and RPC are still pending. Show spinner.
  //   "provisional"    — Turso has data, RPC hasn't resolved yet. Show Turso
  //                      data, but NEVER label it "unowned" based on Turso alone.
  //   "final"          — RPC has resolved. Show RPC result authoritatively.
  // ---------------------------------------------------------------------------
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

  // RPC is considered "resolved" when it has returned data or definitively
  // failed (isLoading turned false). We use `rpcPlot != null` as "has data".
  const rpcHasData = rpcPlot != null;
  const rpcDone = !rpcLoading || rpcHasData;
  const tursoHasData = tursoPlot !== "loading" && tursoPlot !== null;
  // Determine display phase and effective plot.
  //   - "final": RPC has resolved. Use RPC as authoritative source.
  //   - "provisional": RPC is still pending, Turso has data. Show Turso as
  //     fast preview, but NEVER declare it "unowned" based on Turso alone.
  //   - "loading": RPC is still pending, no Turso data. Show loading spinner.
  const phase:
    | "loading"
    | "provisional"
    | "final" = rpcDone
    ? "final"
    : tursoHasData
      ? "provisional"
      : "loading";

  // RPC is authoritative; fall back to Turso when RPC hasn't resolved yet.
  const effectivePlot: Plot | null = rpcHasData
    ? rpcPlot
    : tursoHasData
      ? (tursoPlot as Plot)
      : null;

  // Only RPC can declare a plot truly unowned:
  //   - If phase is "final" and RPC says unowned → show unowned.
  //   - If phase is "provisional" and Turso says unowned → show loading/pending.
  //   - If phase is "loading" → show loading spinner.
  const effectiveOwned =
    phase === "final"
      ? rpcOwned
      : phase === "provisional"
        ? !!effectivePlot &&
          effectivePlot.owner.toLowerCase() !== ZERO_ADDRESS
        : false;

  const open = activePlotId != null;
  const coords = activePlotId != null ? xyFromPlotId(activePlotId) : null;
  const myOffer = (myOfferRaw as bigint | undefined) ?? 0n;

  // The plot's own image/link (set when this plot is the anchor of an image).
  const ownImage = effectivePlot?.imageUri ? stripZone(effectivePlot.imageUri) : null;
  const ownLink = effectivePlot?.imageUri ? parseLink(effectivePlot.imageUri) : null;

  // A multi-plot image lives only on its anchor plot; any other covered pixel
  // carries no metadata. Resolve the spanning image/link covering this pixel so
  // clicking ANY pixel under a batch image shows the same destination link.
  const needCover = !!effectivePlot && !!coords && (!ownImage || !ownLink);
  const covering = useCoveringImage(
    effectivePlot?.owner,
    coords?.x ?? null,
    coords?.y ?? null,
    needCover,
  );
  const displayImage =
    ownImage || (covering.imageUri ? stripZone(covering.imageUri) : null);
  const plotLink = ownLink || covering.link;

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

  // Shareable deep link that re-opens THIS pixel's detail modal on load
  // (read by the app's `?pixel=<id>` handler), available for every owned pixel
  // regardless of whether it has a custom image/link set.
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
      // Fallback for browsers without the async clipboard API.
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable — nothing else to try */
      }
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

          {phase === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Loading pixel…
            </div>
          ) : phase === "provisional" && !effectiveOwned ? (
            // Turso says unowned but we haven't heard from RPC yet — never show
            // a hard "unowned" on Turso alone. Show a pending loader instead.
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Confirming ownership…
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

              {/* Share / copy-link — secondary actions available on every owned
                  pixel, independent of whether it has an image/link set. */}
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
                  {/* Buy Now (only when listed) */}
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

                  {/* Place / manage offer */}
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
