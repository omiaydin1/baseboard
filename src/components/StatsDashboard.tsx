"use client";

import { DISPLAY_MAX_PLOTS } from "@/lib/constants";
import { useBoardStats } from "@/hooks/useBaseBoard";
import { SoldOutStamp } from "./SoldOutStamp";
import { ActivityTicker } from "./ActivityTicker";
import { AnimatedNumber } from "./AnimatedNumber";

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  // Stat boxes were compacted proportionally (same shrink applied to all three)
  // to free header space for the new "Leaderboard" entry — only box width and
  // padding shrink; the number text stays at a legible size.
  return (
    <div
      className={`flex min-w-[88px] flex-1 flex-col rounded-xl border-2 px-2.5 py-1.5 sm:min-w-[118px] sm:px-3 sm:py-2 ${
        accent
          ? "border-base-blue bg-blue-50"
          : "border-blue-100 bg-white"
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-base-light">
        {label}
      </span>
      <AnimatedNumber
        value={value}
        className="text-lg font-black text-base-blue sm:text-xl md:text-2xl"
      />
    </div>
  );
}

/**
 * Dashboard headline stats. "Total Pixels Sold" now reflects the LIVE on-chain
 * count (`totalPlotsSold`, polled + refreshed on every `PlotsPurchased`) via
 * `useBoardStats`, with Remaining and Sold % derived from it. A red "SOLD OUT"
 * stamp overlays the stats once `remaining` hits 0.
 *
 * The "Live" indicator is intentionally slim and integrated into the full-width
 * horizontal bar beneath the stat cards (next to the progress fill + activity
 * ticker) rather than being a bulky bordered box in the cards row.
 */
export function StatsDashboard() {
  const { sold } = useBoardStats();
  // Initial/empty-state baseline is a genuinely empty board (0 sold /
  // DISPLAY_MAX_PLOTS remaining / 0.0000%) — NOT stale placeholder data. The
  // animated digit roll plays from this baseline to the live on-chain values
  // once the first read lands.
  const remaining = Math.max(0, DISPLAY_MAX_PLOTS - sold);
  const pct = ((sold / DISPLAY_MAX_PLOTS) * 100).toFixed(4);
  const soldOut = remaining === 0;

  return (
    <div className="w-full">
      <div className="relative">
        <div className="flex flex-wrap items-stretch gap-2">
          <StatCard
            label="Total Pixels Sold"
            value={sold.toLocaleString()}
            accent
          />
          <StatCard
            label="Remaining Available"
            value={remaining.toLocaleString()}
          />
          <StatCard label="Sold %" value={`${pct}%`} />
        </div>
        {soldOut && <SoldOutStamp />}
      </div>

      {/* Slim live strip integrated into the long horizontal bar. */}
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Live
        </span>
        <ActivityTicker />
      </div>
    </div>
  );
}
