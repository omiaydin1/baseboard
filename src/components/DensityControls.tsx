"use client";

import { DENSITY_BANDS, densitySwatch } from "@/lib/density";
import { useBoardStore } from "@/store/useBoardStore";

/**
 * Bottom-centered control bar for the purchase-density heatmap, overlaid on the
 * board frame. Holds the on/off toggle ("Density") plus the activity ruler that
 * was previously in the page footer — the ruler's gradient is built from the
 * same `densitySwatch` levels the overlay uses, so it stays an accurate key.
 *
 * Hidden while the tap-to-buy basket bar is active (which occupies the same
 * bottom-center spot) so the two never collide.
 */
export function DensityControls() {
  const enabled = useBoardStore((s) => s.densityEnabled);
  const toggle = useBoardStore((s) => s.toggleDensity);
  const selectMode = useBoardStore((s) => s.selectMode);
  const basketCount = useBoardStore((s) => s.basket.length);

  if (selectMode || basketCount > 0) return null;

  const gradient = `linear-gradient(to right, ${densitySwatch(0)}, ${densitySwatch(
    1,
  )})`;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border-2 border-blue-100 bg-white/95 px-2.5 py-1.5 shadow-md backdrop-blur sm:gap-3 sm:px-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle purchase-density heatmap"
        onClick={toggle}
        className="flex items-center gap-2"
      >
        <span className="text-xs font-semibold text-slate-600">Density</span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-base-blue" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
              enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </span>
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200" />

      <div
        className={`flex items-center gap-2 transition-opacity ${
          enabled ? "" : "opacity-40"
        }`}
      >
        <span className="text-[11px] font-medium text-slate-500">Activity</span>
        <div className="flex flex-col gap-0.5">
          <div
            className="h-2 w-20 rounded-full border border-slate-200 sm:w-28"
            style={{ background: gradient }}
          />
          <div className="hidden w-20 justify-between sm:flex sm:w-28">
            {DENSITY_BANDS.map((b) => (
              <span key={b.label} className="text-[9px] text-slate-400">
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
