"use client";

import { useEffect, useRef, useState } from "react";
import { useAllMintedContext } from "@/hooks/useAllMintedContext";
import { useBaseName } from "@/hooks/useBaseName";
import { shortAddress } from "@/lib/coords";
import type { PurchaseEvent } from "@/hooks/useBaseBoard";

const ROTATE_MS = 5000;

/**
 * Single-line live activity strip beside the "Live" badge. Shows real
 * `PlotsPurchased` activity (never placeholder data): a brand-new purchase jumps
 * to the front and shows immediately; during quiet periods it gently cycles
 * through recent real purchases on a fixed interval so it's never empty or
 * frozen. Same Basename-or-6+6-address rule as the leaderboard rows. Styled to
 * match the existing small header labels — no separate themed widget.
 */
export function ActivityTicker() {
  const { events } = useAllMintedContext();
  const [index, setIndex] = useState(0);

  // When a brand-new purchase arrives at the front, surface it immediately.
  const latestKey = events[0]?.txHash ?? "";
  const prevLatestRef = useRef(latestKey);
  useEffect(() => {
    if (latestKey && latestKey !== prevLatestRef.current) {
      prevLatestRef.current = latestKey;
      setIndex(0);
    }
  }, [latestKey]);

  // Gently rotate through recent purchases during quiet periods.
  useEffect(() => {
    if (events.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % events.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [events.length]);

  if (events.length === 0) return null;

  const current = events[Math.min(index, events.length - 1)];
  return <TickerLine key={current.txHash} event={current} />;
}

function TickerLine({ event }: { event: PurchaseEvent }) {
  const baseName = useBaseName(event.buyer);
  const who = baseName ? shortAddress(baseName) : shortAddress(event.buyer);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-slate-500">
      <span className="truncate font-mono font-semibold text-slate-600">
        {who}
      </span>
      <span className="shrink-0">
        bought {event.count.toLocaleString()} pixel
        {event.count === 1 ? "" : "s"}
      </span>
    </span>
  );
}
