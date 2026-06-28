"use client";

/**
 * Red diagonal "SOLD OUT" stamp. Rendered over the stats area only when every
 * pixel is gone (`remaining === 0`). Stats are hardcoded above zero for now, so
 * this never triggers in production yet — it activates automatically once live
 * tracking lands. Pointer-events are disabled so it never blocks the UI beneath.
 */
export function SoldOutStamp({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <span className="-rotate-12 select-none rounded-lg border-4 border-red-600 bg-white/70 px-4 py-1 text-xl font-black uppercase tracking-[0.25em] text-red-600 shadow-lg sm:text-3xl">
        Sold Out
      </span>
    </div>
  );
}
