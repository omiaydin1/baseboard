import { create } from "zustand";
import type { BBox } from "@/lib/coords";
import type { Plot } from "@/lib/types";

/** A region selected on the board for the event-creation flow. */
export interface EventDraft {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface BoardUIState {
  /** Profile drawer open/closed. */
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;
  toggleProfile: () => void;

  /** Leaderboard drawer open/closed (same slide-in mechanism as profile). */
  leaderboardOpen: boolean;
  setLeaderboardOpen: (open: boolean) => void;
  toggleLeaderboard: () => void;

  /** Event drawer open/closed (lists reveal events; same slide-in mechanism). */
  eventDrawerOpen: boolean;
  setEventDrawerOpen: (open: boolean) => void;
  toggleEventDrawer: () => void;

  /**
   * Event-creation flow: when true the board's selection tools capture a
   * region (marquee or click) as an event draft instead of a buy selection.
   * The drawer closes while the user frames their area; the selection
   * reopens it in "create" view with the coordinates pre-filled.
   */
  eventCreateMode: boolean;
  setEventCreateMode: (on: boolean) => void;

  /** Selected event region from the board (created via the create flow). */
  eventDraft: EventDraft | null;
  setEventDraft: (draft: EventDraft | null) => void;

  /**
   * Whether the purchase-density (heatmap) overlay is shown. When false the
   * overlay is fully disabled: the canvas skips both baking the density field
   * and drawing it, so there is zero density-related work in the render path.
   */
  densityEnabled: boolean;
  setDensityEnabled: (on: boolean) => void;
  toggleDensity: () => void;

  /** Currently inspected existing plot (opens the plot detail modal). */
  activePlotId: number | null;
  openPlot: (id: number) => void;
  closePlot: () => void;

  /** Pending buy selection (single cell or marquee box) — opens buy modal. */
  buySelection: BBox | null;
  setBuySelection: (box: BBox | null) => void;
  clearBuySelection: () => void;

  /** Explicit plot-id list to buy (from the tap-to-add basket) — opens buy modal. */
  directBuyIds: number[] | null;
  setDirectBuyIds: (ids: number[] | null) => void;

  /** Tap-to-add multi-select ("basket") mode for touch screens. */
  selectMode: boolean;
  setSelectMode: (on: boolean) => void;
  toggleSelectMode: () => void;

  /** Plot ids queued in the basket while in select mode. */
  basket: number[];
  toggleBasketPlot: (id: number) => void;
  clearBasket: () => void;

  /**
   * Optimistic plot overrides merged on top of freshly-read on-chain data so
   * the board reflects a buy/sell/image change instantly after a tx confirms,
   * without waiting for the next poll. Replaced by real reads when they land.
   */
  optimisticPlots: Record<number, Plot>;
  applyOptimisticPlots: (plots: Record<number, Plot>) => void;
  clearOptimisticPlots: () => void;
  /** Remove confirmed plot IDs from optimistic overrides so stale entries
   *  (e.g. empty imageUri after a real image was uploaded, or old owner after
   *  a resale) never overwrite authoritative data on subsequent fetch cycles. */
  removeConfirmedPlots: (ids: number[]) => void;

  /** Monotonic counter bumped after a tx settles to force data refetches. */
  refreshNonce: number;
  bumpRefresh: () => void;

  /** Plot id the canvas should fly to / highlight (from the profile list). */
  focusPlotId: number | null;
  setFocusPlotId: (id: number | null) => void;

  /** Bounding box the canvas should zoom to fit (from "Show on Board"). */
  focusBounds: { x1: number; y1: number; x2: number; y2: number } | null;
  setFocusBounds: (bounds: { x1: number; y1: number; x2: number; y2: number } | null) => void;

  /** Transient toast notifications (tx success / failure, validation). */
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

let _toastId = 0;

export const useBoardStore = create<BoardUIState>((set) => ({
  profileOpen: false,
  setProfileOpen: (open) =>
    set({ profileOpen: open, leaderboardOpen: false, eventDrawerOpen: false }),
  toggleProfile: () =>
    set((s) => ({
      profileOpen: !s.profileOpen,
      leaderboardOpen: false,
      eventDrawerOpen: false,
    })),

  leaderboardOpen: false,
  setLeaderboardOpen: (open) =>
    set({ leaderboardOpen: open, profileOpen: false, eventDrawerOpen: false }),
  toggleLeaderboard: () =>
    set((s) => ({
      leaderboardOpen: !s.leaderboardOpen,
      profileOpen: false,
      eventDrawerOpen: false,
    })),

  eventDrawerOpen: false,
  setEventDrawerOpen: (open) =>
    set({ eventDrawerOpen: open, profileOpen: false, leaderboardOpen: false }),
  toggleEventDrawer: () =>
    set((s) => ({
      eventDrawerOpen: !s.eventDrawerOpen,
      profileOpen: false,
      leaderboardOpen: false,
    })),

  eventCreateMode: false,
  setEventCreateMode: (on) =>
    set((s) => (on ? { eventCreateMode: true, basket: [] } : { eventCreateMode: false })),

  eventDraft: null,
  setEventDraft: (draft) => set({ eventDraft: draft }),

  densityEnabled: false,
  setDensityEnabled: (on) => set({ densityEnabled: on }),
  toggleDensity: () => set((s) => ({ densityEnabled: !s.densityEnabled })),

  activePlotId: null,
  openPlot: (id) =>
    set({ activePlotId: id, buySelection: null, directBuyIds: null }),
  closePlot: () => set({ activePlotId: null }),

  buySelection: null,
  setBuySelection: (box) =>
    set({ buySelection: box, directBuyIds: null, activePlotId: null }),
  clearBuySelection: () => set({ buySelection: null }),

  directBuyIds: null,
  setDirectBuyIds: (ids) =>
    set({ directBuyIds: ids, buySelection: null, activePlotId: null }),

  selectMode: false,
  setSelectMode: (on) => set({ selectMode: on }),
  toggleSelectMode: () =>
    set((s) => ({ selectMode: !s.selectMode, basket: [] })),

  basket: [],
  toggleBasketPlot: (id) =>
    set((s) =>
      s.basket.includes(id)
        ? { basket: s.basket.filter((b) => b !== id) }
        : { basket: [...s.basket, id] },
    ),
  clearBasket: () => set({ basket: [] }),

  optimisticPlots: {},
  applyOptimisticPlots: (plots) =>
    set((s) => ({ optimisticPlots: { ...s.optimisticPlots, ...plots } })),
  clearOptimisticPlots: () => set({ optimisticPlots: {} }),
  removeConfirmedPlots: (ids) =>
    set((s) => {
      const next = { ...s.optimisticPlots };
      for (const id of ids) delete next[id];
      return { optimisticPlots: next };
    }),

  refreshNonce: 0,
  bumpRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),

  focusPlotId: null,
  setFocusPlotId: (id) => set({ focusPlotId: id }),

  focusBounds: null,
  setFocusBounds: (bounds) => set({ focusBounds: bounds }),

  toasts: [],
  pushToast: (kind, message) => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (typeof window !== "undefined") {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 4500);
    }
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
