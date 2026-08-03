/**
 * Community event "reveal" layers.
 *
 * An event marks a rectangular region of the board whose unowned pixels show
 * a semi-transparent grayscale "ghost" of an image. When a plot in the region
 * is bought, its cell reveals the real colour of the image at that spot — the
 * classic "colour-by-numbers" mechanic. The region stays fully purchasable
 * through the normal buy flow; nothing is reserved on-chain.
 *
 * The list is an array so further events can be added without touching the
 * renderer.
 */

export interface EventReveal {
  /** Stable id used for caches and lookup. */
  id: string;
  /** Human-readable title (fly-to button, plot modal notice). */
  title: string;
  /** Inclusive region bounding box (grid coordinates). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Same-origin image path served from /public (CORS-safe, pixel-readable). */
  imagePath: string;
  /**
   * Link attached to every BOUGHT pixel in the region: the pixel details modal
   * shows this automatically (instead of any owner-set link) and it opens in a
   * new tab. Per-event — each image can carry its own destination.
   */
  link?: string;
  /**
   * Wallet address that created this event (dynamic events only; seed events
   * like the launch artwork have none). Only the creator may edit the link.
   */
  creator?: string;
  /**
   * How many plots inside the region are currently purchased (dynamic events
   * only, computed from the Turso plot index on each GET /api/events). Used by
   * the creator's profile to show progress; seed events have no value.
   */
  soldCount?: number;
  /** Opacity of the grayscale ghost layer (0..1). */
  ghostAlpha: number;
  /** Colour of the thin region outline. */
  outlineColor: string;
}

export const EVENT_REVEALS: EventReveal[] = [
  {
    id: "event-1",
    title: "jessepollak",
    x1: 1215,
    y1: 1540,
    x2: 1414,
    y2: 1739,
    imagePath: "/event/event1.jpg",
    link: "https://x.com/jessepollak",
    ghostAlpha: 0.5,
    outlineColor: "#0052ff",
  },
];

/** Find the event whose region contains cell (x, y), or null. */
export function getEventForCell(x: number, y: number): EventReveal | null {
  for (const c of EVENT_REVEALS) {
    if (x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2) return c;
  }
  return null;
}

/** Number of plots inside an event region. */
export function eventPlotCount(c: EventReveal): number {
  return (c.x2 - c.x1 + 1) * (c.y2 - c.y1 + 1);
}
