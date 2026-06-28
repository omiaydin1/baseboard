import { DENSITY_BANDS, densitySwatch } from "@/lib/density";

/**
 * Thin gradient key for the purchase-density overlay (Part 10.3). The bar is
 * built from the same `densitySwatch` levels the overlay uses, so it reads as
 * the legend for that blue tint — least → most purchase activity.
 */
export function DensityLegend() {
  const gradient = `linear-gradient(to right, ${densitySwatch(0)}, ${densitySwatch(
    1,
  )})`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-600">Activity</span>
      <div className="flex flex-col gap-0.5">
        <div
          className="h-2 w-28 rounded-full border border-slate-200 sm:w-36"
          style={{ background: gradient }}
        />
        <div className="flex w-28 justify-between sm:w-36">
          {DENSITY_BANDS.map((b) => (
            <span key={b.label} className="text-[10px] text-slate-400">
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
