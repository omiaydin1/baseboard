"use client";

import {
  PIXELS_REMAINING_DISPLAY,
  PIXELS_SOLD_DISPLAY,
  SOLD_PCT_DISPLAY,
} from "@/lib/constants";
import { SoldOutStamp } from "./SoldOutStamp";

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[110px] flex-1 flex-col rounded-xl border-2 px-3 py-1.5 sm:min-w-[150px] sm:px-4 sm:py-2 ${
        accent
          ? "border-base-blue bg-blue-50"
          : "border-blue-100 bg-white"
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-base-light">
        {label}
      </span>
      <span className="text-lg font-black tabular-nums text-base-blue sm:text-xl md:text-2xl">
        {value}
      </span>
    </div>
  );
}

/**
 * Dashboard headline stats. Values are fixed display constants for now (see
 * `constants.ts`) — Total Pixels Sold / Remaining Available / Sold %. A red
 * "SOLD OUT" stamp overlays the stats once `remaining` hits 0 (won't trigger
 * while the count is hardcoded above zero, but is wired so it activates
 * automatically when live tracking is added later).
 */
export function StatsDashboard() {
  const sold = PIXELS_SOLD_DISPLAY;
  const remaining = PIXELS_REMAINING_DISPLAY;
  const pct = SOLD_PCT_DISPLAY;
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
          <div className="flex items-center gap-2 rounded-xl border-2 border-green-200 bg-green-50 px-3 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span className="text-xs font-semibold text-green-700">Live</span>
          </div>
        </div>
        {soldOut && <SoldOutStamp />}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full rounded-full bg-base-blue transition-all"
          style={{ width: `${Math.min(100, Number(pct))}%` }}
        />
      </div>
    </div>
  );
}
