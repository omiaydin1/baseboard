import { create } from "zustand";
import type { BBox } from "@/lib/coords";

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

  /** Monotonic counter bumped after a tx settles to force data refetches. */
  refreshNonce: number;
  bumpRefresh: () => void;

  /** Plot id the canvas should fly to / highlight (from the profile list). */
  focusPlotId: number | null;
  setFocusPlotId: (id: number | null) => void;
}

export const useBoardStore = create<BoardUIState>((set) => ({
  profileOpen: false,
  setProfileOpen: (open) => set({ profileOpen: open }),
  toggleProfile: () => set((s) => ({ profileOpen: !s.profileOpen })),

  activePlotId: null,
  openPlot: (id) => set({ activePlotId: id, buySelection: null }),
  closePlot: () => set({ activePlotId: null }),

  buySelection: null,
  setBuySelection: (box) => set({ buySelection: box, activePlotId: null }),
  clearBuySelection: () => set({ buySelection: null }),

  refreshNonce: 0,
  bumpRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),

  focusPlotId: null,
  setFocusPlotId: (id) => set({ focusPlotId: id }),
}));
