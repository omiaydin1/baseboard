"use client";

import { useActiveChainConfig } from "@/hooks/useActiveContract";

/**
 * The "BaseBoard" title plaque, styled to look like a framed sign hanging from
 * a nail in the wall by two taut ropes. Pure SVG + CSS, no images.
 */
export function HangingHeader() {
  const cfg = useActiveChainConfig();
  return (
    <div className="pointer-events-none relative z-20 flex flex-col items-center">
      {/* Nail driven into the wall */}
      <div className="relative h-2 w-3">
        <div className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-slate-400 shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
        <div className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-600" />
      </div>

      {/* Two ropes from the nail down to the corners of the plaque */}
      <svg
        width="200"
        height="38"
        viewBox="0 0 220 58"
        className="-mb-2"
        aria-hidden="true"
      >
        <line
          x1="110"
          y1="2"
          x2="34"
          y2="54"
          stroke="#b45309"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="110"
          y1="2"
          x2="186"
          y2="54"
          stroke="#b45309"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* small ring at the nail */}
        <circle cx="110" cy="3" r="3.5" fill="none" stroke="#92400e" strokeWidth="2" />
      </svg>

      {/* The plaque itself — a fully framed sign with a clean gap above the
          board. Its border uses the exact same solid Base blue as the main
          canvas frame so the two read as one matching theme. */}
      <div className="relative rounded-2xl border-4 border-base-blue bg-white px-8 py-1.5 shadow-frame">
        {/* mounting eyelets the ropes attach to */}
        <span className="absolute -top-2 left-4 h-3 w-3 rounded-full border-2 border-base-blue bg-white" />
        <span className="absolute -top-2 right-4 h-3 w-3 rounded-full border-2 border-base-blue bg-white" />
        <h1 className="select-none text-center text-2xl font-black tracking-tight text-base-blue sm:text-3xl">
          BaseBoard
        </h1>
        <p className="mt-0 text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-base-light">
          10,000,000 plots · {cfg.name}
        </p>
      </div>
    </div>
  );
}
