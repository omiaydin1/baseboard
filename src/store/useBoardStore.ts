import { create } from "zustand";
import type { BBox } from "@/lib/coords";
import type { Plot } from "@/lib/types";

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

  /** Monotonic counter bumped after a tx settles to force data refetches. */
  refreshNonce: number;
  bumpRefresh: () => void;

  /** Plot id the canvas should fly to / highlight (from the profile list). */
  focusPlotId: number | null;
  setFocusPlotId: (id: number | null) => void;

  /** Transient toast notifications (tx success / failure, validation). */
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

let _toastId = 0;

export const useBoardStore = create<BoardUIState>((set) => ({
  profileOpen: false,
  setProfileOpen: (open) => set({ profileOpen: open }),
  toggleProfile: () => set((s) => ({ profileOpen: !s.profileOpen })),

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

  refreshNonce: 0,
  bumpRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),

  focusPlotId: null,
  setFocusPlotId: (id) => set({ focusPlotId: id }),

  toasts: [],
  pushToast: (kind, message) => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 4500);
    }
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
