"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { useBoardStore } from "@/store/useBoardStore";
import { shortAddress, xyFromPlotId } from "@/lib/coords";
import { parseLink, parseZone, stripZone } from "@/lib/image";
import { getEventForCell, useEvents } from "@/lib/eventReveals";
import { ZERO_ADDRESS } from "@/lib/constants";
import type { Plot } from "@/lib/types";
import { fetchTursoBoard } from "@/lib/tursoClient";

export function PlotModal() {
  const activePlotId = useBoardStore((s) => s.activePlotId);
  const closePlot = useBoardStore((s) => s.closePlot);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const { address } = useAccount();
  // Keep the event-region resolution in sync with the loaded event list.
  useEvents();

  const [copied, setCopied] = useState(false);

  // Turso-only data (no RPC reads)
  const [tursoPlot, setTursoPlot] = useState<Plot | null | "loading">("loading");

  useEffect(() => {
    if (activePlotId == null) return;
    setTursoPlot("loading");
    let cancelled = false;

    const fetch = async () => {
      const res = await fetchTursoBoard([activePlotId]);
      if (cancelled) return;
      let p: Plot | null = res?.plots?.[activePlotId] ?? null;

      // If the plot is owned but has no imageUri, check if the owner has a
      // zone image (via #bb=x1,y1,x2,y2 fragment) that covers this pixel.
      if (p && p.owner.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && !p.imageUri) {
        const owner = p.owner.toLowerCase();
        const allRes = await fetchTursoBoard();
        if (cancelled) return;
        if (allRes) {
          const { x, y } = xyFromPlotId(activePlotId);
          for (const plot of Object.values(allRes.plots)) {
            if (plot.owner.toLowerCase() !== owner || !plot.imageUri) continue;
            const zone = parseZone(plot.imageUri);
            if (zone && x >= zone.x1 && x <= zone.x2 && y >= zone.y1 && y <= zone.y2) {
              p = { ...p, imageUri: plot.imageUri };
              break;
            }
          }
        }
      }

      if (!cancelled) setTursoPlot(p);
    };

    fetch();
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

  // Event regions: bought pixels show the event's own link automatically and
  // never display third-party artwork — on the board only the reveal colour
  // appears, and here the buyer's wallet + the event link are shown instead.
  const eventRegion =
    effectiveOwned && coords ? getEventForCell(coords.x, coords.y) : null;

  // The plot's own image/link
  const ownImage = effectivePlot?.imageUri ? stripZone(effectivePlot.imageUri) : null;
  const ownLink = effectivePlot?.imageUri ? parseLink(effectivePlot.imageUri) : null;
  const displayImage = eventRegion ? null : ownImage;
  const plotLink = eventRegion?.link ?? ownLink;

  const isOwner =
    !!effectivePlot &&
    !!address &&
    effectivePlot.owner.toLowerCase() === address.toLowerCase();

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
                  width="100%"
                  height={160}
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
                {plotLink && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">
                      {eventRegion ? "Event link" : "Link"}
                    </dt>
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

              {isOwner ? (
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
              ) : null}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
