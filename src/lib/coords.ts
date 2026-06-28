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

/** Shorten an address for display: 0x1234…abcd. */
export function shortAddress(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Privacy-display address truncation showing the first 6 and last 6 characters
 * with the middle hidden, e.g. `0x71aa…6f812b`. Used by the leaderboard rows and
 * the activity ticker (a longer tail than `shortAddress`'s 6+4). A resolved
 * Basename is middle-truncated the same way when it's too long to show in full.
 */
export function shortAddressLong(value?: string | null): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}
