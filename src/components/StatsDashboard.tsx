"use client";

import { useBoardStats } from "@/hooks/useBaseBoard";
import { DISPLAY_MAX_PLOTS, IS_CONTRACT_CONFIGURED } from "@/lib/constants";

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
      className={`flex min-w-[110px] flex-1 flex-col rounded-xl border-2 px-3 py-2 sm:min-w-[150px] sm:px-4 sm:py-2.5 ${
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

/** Reactive dashboard: total sold + remaining, refreshed via polling + events. */
export function StatsDashboard() {
  const { sold, remaining } = useBoardStats();
  const pct = ((sold / DISPLAY_MAX_PLOTS) * 100).toFixed(4);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-stretch gap-3">
        <StatCard label="Total Plots Sold" value={sold.toLocaleString()} accent />
        <StatCard
          label="Remaining Available"
          value={remaining.toLocaleString()}
        />
        <StatCard label="Sold %" value={`${pct}%`} />
        <div className="flex items-center gap-2 rounded-xl border-2 border-green-200 bg-green-50 px-3 py-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <span className="text-xs font-semibold text-green-700">Live</span>
        </div>
      </div>
      {!IS_CONTRACT_CONFIGURED && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          Contract address not configured. Set{" "}
          <code className="font-mono">NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS</code>{" "}
          to enable live on-chain stats and transactions.
        </p>
      )}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full rounded-full bg-base-blue transition-all"
          style={{ width: `${Math.min(100, Number(pct))}%` }}
        />
      </div>
    </div>
  );
}
