"use client";

import { useEffect, useState } from "react";

/**
 * Odometer-style numeric display. Each digit sits in its own subtle slate
 * "well" and rolls vertically when it changes (only the digits that actually
 * change animate — unchanged digits stay put because each digit column simply
 * translates to its current value). Non-digit characters (commas, ".", "%")
 * render plainly without a well. The digit glyphs keep the caller's existing
 * colour/weight/size — this only adds the per-digit background + roll.
 */

const DIGIT_H = "1.15em";
const DIGIT_W = "0.62em";

function Digit({ value }: { value: number }) {
  return (
    <span
      className="relative inline-block overflow-hidden rounded-[3px] bg-slate-100 align-baseline"
      style={{ height: DIGIT_H, width: DIGIT_W }}
    >
      <span
        className="absolute left-0 top-0 flex w-full flex-col transition-transform duration-500 ease-out"
        style={{ transform: `translateY(-${value * 1.15}em)` }}
        aria-hidden
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span
            key={n}
            className="flex items-center justify-center"
            style={{ height: DIGIT_H }}
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

export function AnimatedNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const display = mounted ? value : "0";
  return (
    <span className={`inline-flex items-center tabular-nums ${className ?? ""}`}>
      {/* Accessible plain value for screen readers. */}
      <span className="sr-only">{display}</span>
      <span aria-hidden className="inline-flex items-center gap-[1px]">
        {display.split("").map((ch, i) =>
          /[0-9]/.test(ch) ? (
            <Digit key={i} value={Number(ch)} />
          ) : (
            <span key={i} className="inline-block px-[0.5px]">
              {ch}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
