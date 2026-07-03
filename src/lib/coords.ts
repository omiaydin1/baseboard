import { GRID_SIZE, PLOT_PRICE_WEI } from "./constants";
import { formatEther } from "viem";

/** Serialize 2D coordinates into a single plot id: plotId = (y * GRID_SIZE) + x. */
export function plotIdFromXY(x: number, y: number): number {
  return y * GRID_SIZE + x;
}

/** Deserialize a plot id back into (x, y) coordinates. */
export function xyFromPlotId(plotId: number): { x: number; y: number } {
  return {
    x: plotId % GRID_SIZE,
    y: Math.floor(plotId / GRID_SIZE),
  };
}

/** Inclusive bounding box of grid coordinates. */
export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Normalize a raw drag box so x1<=x2, y1<=y2 and values are clamped to grid. */
export function normalizeBBox(box: BBox): BBox {
  const x1 = clamp(Math.min(box.x1, box.x2), 0, GRID_SIZE - 1);
  const y1 = clamp(Math.min(box.y1, box.y2), 0, GRID_SIZE - 1);
  const x2 = clamp(Math.max(box.x1, box.x2), 0, GRID_SIZE - 1);
  const y2 = clamp(Math.max(box.y1, box.y2), 0, GRID_SIZE - 1);
  return { x1, y1, x2, y2 };
}

/** Number of plots inside an inclusive bounding box. */
export function bboxPlotCount(box: BBox): number {
  const n = normalizeBBox(box);
  return (n.x2 - n.x1 + 1) * (n.y2 - n.y1 + 1);
}

/** Enumerate every plot id inside a bounding box (use with care for huge boxes). */
export function bboxToPlotIds(box: BBox): number[] {
  const n = normalizeBBox(box);
  const ids: number[] = [];
  for (let y = n.y1; y <= n.y2; y++) {
    for (let x = n.x1; x <= n.x2; x++) {
      ids.push(plotIdFromXY(x, y));
    }
  }
  return ids;
}

/** Total wei for buying `count` plots at the flat primary price. */
export function totalPriceWei(count: number): bigint {
  return PLOT_PRICE_WEI * BigInt(count);
}

/** Human-readable ETH string for `count` plots. */
export function totalPriceEth(count: number): string {
  return formatEther(totalPriceWei(count));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Single canonical identity truncation used EVERYWHERE a wallet address (or a
 * too-long Basename) is shown — header, profile, leaderboard, ticker, plot
 * modal — so the shortened form is uniform across the whole app: first 6 +
 * last 6 with the middle hidden, e.g. `0x71aa…6f812b`. Short values (≤14 chars,
 * e.g. a compact Basename) are returned in full.
 */
export function shortAddress(value?: string | null): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

/**
 * Human-readable display name for a leaderboard row or activity ticker entry.
 * Basenames (e.g. `omiaydin.base.eth`) render as first‑3‑chars + `…` + domain
 * suffix (`omi…base.eth`). Raw hex addresses use the standard `shortAddress`
 * format (`0x71aa…6f812b`).
 */
export function displayName(
  baseName: string | null | undefined,
  address: string | undefined | null,
): string {
  // Basename with dots → short‑3 format (e.g. `omiaydin.base.eth` → `omi…base.eth`)
  if (baseName && baseName.includes(".")) {
    const dot = baseName.indexOf(".");
    const suffix = baseName.slice(dot + 1); // everything after first dot
    return `${baseName.slice(0, 3)}…${suffix}`;
  }
  // Explicit basename but no dots → return as-is (unusual, could be a short name)
  if (baseName) return baseName;
  // Fall back to short hex address
  return shortAddress(address);
}

/** @deprecated Use `shortAddress`; kept as an alias for the unified 6+6 rule. */
export const shortAddressLong = shortAddress;
