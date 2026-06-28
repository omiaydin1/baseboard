/**
 * Shared parameters for the purchase-density overlay (Part 10.2) and its legend
 * (Part 10.3). Both consume these so the legend always reflects the actual
 * overlay intensities rather than a separately hardcoded gradient.
 */

/** Overlay hue — the app's Base blue. Only its opacity varies with density. */
export const DENSITY_RGB = { r: 0, g: 82, b: 255 } as const;

/**
 * Maximum overlay alpha at the single most purchase-dense region. Capped well
 * below 1 so the underlying pixel colour is always visible through the overlay —
 * there is no density level at which it becomes opaque.
 */
export const DENSITY_ALPHA_CAP = 0.55;

/** Density field resolution: BUCKETS×BUCKETS coarse cells over the whole grid. */
export const DENSITY_BUCKETS = 64;

/**
 * Recency window for "recent purchases", in blocks. Base targets ~2s blocks, so
 * 7 days ≈ 302,400 blocks. Density counts purchases inside this window; it falls
 * back to all-time counts when recent activity is too sparse for a useful field.
 */
export const DENSITY_RECENT_WINDOW_BLOCKS = (7 * 24 * 3600) / 2;

/** Below this many recent purchases we fall back to the all-time field. */
export const DENSITY_RECENT_MIN = 8;

/**
 * Perceived legend swatch colour for a normalized density level in [0,1]:
 * the capped-alpha blue overlay composited over the white board, so the legend
 * swatches match what the overlay actually looks like on the board.
 */
export function densitySwatch(level: number): string {
  const a = Math.max(0, Math.min(1, level)) * DENSITY_ALPHA_CAP;
  const r = Math.round(255 * (1 - a) + DENSITY_RGB.r * a);
  const g = Math.round(255 * (1 - a) + DENSITY_RGB.g * a);
  const b = Math.round(255 * (1 - a) + DENSITY_RGB.b * a);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Ordered density bands for the legend (least → most dense). */
export const DENSITY_BANDS = [
  { label: "Quiet", level: 0.08 },
  { label: "Active", level: 0.4 },
  { label: "Busy", level: 0.72 },
  { label: "Hot", level: 1 },
] as const;
