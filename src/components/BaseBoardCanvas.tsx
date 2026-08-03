"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePublicClient, useAccount, useChainId, useWatchContractEvent } from "wagmi";
import { baseBoardAbi, readContractWithTimeout } from "@/lib/contract";
import { GRID_SIZE, MAX_EVENT_AREA, ZERO_ADDRESS } from "@/lib/constants";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { clamp, plotIdFromXY, xyFromPlotId } from "@/lib/coords";
import { parseZone, stripZone } from "@/lib/image";
import { getEventForCell, getEvents, loadEvents, subscribeEvents } from "@/lib/eventReveals";
import type { EventReveal } from "@/lib/event";
import {
  DENSITY_ALPHA_CAP,
  DENSITY_BUCKETS,
  DENSITY_RECENT_MIN,
  DENSITY_RECENT_WINDOW_BLOCKS,
  DENSITY_RGB,
} from "@/lib/density";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";
import { useShallow } from "zustand/react/shallow";
import { fetchTursoBoard } from "@/lib/tursoClient";

type Tool = "pan" | "select";

interface Camera {
  camX: number; // world cell at the left edge
  camY: number; // world cell at the top edge
  scale: number; // pixels per cell
}

const MIN_SCALE_FLOOR = 0.12;
const MAX_SCALE = 48;
const GRID_FADE_START = 4; // px/cell where grid lines begin to appear
const GRID_FADE_FULL = 12; // px/cell where grid lines are fully opaque
const IMAGE_MIN_SCALE = 6; // px/cell before images are drawn
const LOD_THUMB_DIM = 128; // longest side of the cached LOD thumbnail
// Above this many on-screen image groups we always blit the cheap LOD
// thumbnail instead of the full-resolution source, even when zoomed in.
const LOD_FULL_MAX_GROUPS = 120;
// Icon-mode constants for extreme zoom-out. When an image group's on-screen
// span is below MIN_ICON_PX its LOD thumbnail is drawn as a proportional icon
// instead — 1×1 groups get the smallest icon, the largest visible group gets
// the biggest — so relative sizes are preserved even at max zoom.
const MIN_ICON_PX = 4;
const MAX_ICON_PX = 20;
const IMAGE_CACHE_MAX = 200; // max entries in imageCacheRef before LRU eviction
const LOD_CACHE_MAX = 200;   // max entries in lodCacheRef before LRU eviction
// Longest side cap for baked event canvases (colour + grayscale twins).
const EVENT_BAKE_MAX_DIM = 2048;
// Longest side cap for the event reveal scratch layer. The layer is only an
// intermediate for the destination-in mask clip, and event sources are
// ~2px/cell, so capping it keeps deep-zoom memory bounded (~4 MB max).
const EVENT_LAYER_MAX_DIM = 1024;
const DRAG_THRESHOLD = 4; // px movement before a press counts as a drag
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const BOARD_CACHE_KEY = "baseboard:board-data";
const BOARD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes — covers the 5-min indexer gap

interface CachedBoardWire {
  plots: Record<string, { owner: string; price: string; isForSale: boolean; imageUri: string }>;
  timestamp: number;
}

function loadBoardCache(): Record<number, Plot> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BOARD_CACHE_KEY);
    if (!raw) return null;
    const cached: CachedBoardWire = JSON.parse(raw);
    if (Date.now() - cached.timestamp > BOARD_CACHE_TTL) return null;
    const plots: Record<number, Plot> = {};
    for (const [id, p] of Object.entries(cached.plots)) {
      plots[Number(id)] = {
        owner: p.owner as `0x${string}`,
        price: BigInt(p.price),
        isForSale: p.isForSale,
        imageUri: p.imageUri,
      };
    }
    return plots;
  } catch (err) {
    console.error("loadBoardCache: failed to load board cache", err);
    return null;
  }
}

function saveBoardCache(plots: Record<number, Plot>): void {
  if (typeof window === "undefined") return;
  try {
    const serializable: Record<string, CachedBoardWire["plots"][string]> = {};
    for (const [id, p] of Object.entries(plots)) {
      serializable[id] = {
        owner: p.owner,
        price: p.price.toString(),
        isForSale: p.isForSale,
        imageUri: p.imageUri,
      };
    }
    localStorage.setItem(
      BOARD_CACHE_KEY,
      JSON.stringify({ plots: serializable, timestamp: Date.now() } satisfies CachedBoardWire),
    );
  } catch (err) {
    console.error("saveBoardCache: failed to save board cache", err);
  }
}

const IPFS_GATEWAYS = [
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
  (cid: string) => `https://nftstorage.link/ipfs/${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
];



/**
 * High-performance, virtualized HTML5 canvas renderer for the 3162x3162 grid.
 * Supports logarithmic wheel-zoom, click-drag panning, single-cell selection,
 * and marquee box selection — drawing only the cells visible in the viewport.
 */
export function BaseBoardCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const cfg = useActiveChainConfig();

  const store = useBoardStore(
    useShallow((s) => ({
      openPlot: s.openPlot,
      setBuySelection: s.setBuySelection,
      refreshNonce: s.refreshNonce,
      focusPlotId: s.focusPlotId,
      setFocusPlotId: s.setFocusPlotId,
      focusBounds: s.focusBounds,
      setFocusBounds: s.setFocusBounds,
      selectMode: s.selectMode,
      toggleSelectMode: s.toggleSelectMode,
      basket: s.basket,
      toggleBasketPlot: s.toggleBasketPlot,
      clearBasket: s.clearBasket,
      setDirectBuyIds: s.setDirectBuyIds,
      optimisticPlots: s.optimisticPlots,
      clearOptimisticPlots: s.clearOptimisticPlots,
      densityEnabled: s.densityEnabled,
      eventCreateMode: s.eventCreateMode,
      setEventCreateMode: s.setEventCreateMode,
      setEventDraft: s.setEventDraft,
      setEventDrawerOpen: s.setEventDrawerOpen,
      pushToast: s.pushToast,
    })),
  );
  const {
    openPlot,
    setBuySelection,
    refreshNonce,
    focusPlotId,
    setFocusPlotId,
    focusBounds,
    setFocusBounds,
    selectMode,
    toggleSelectMode,
    basket,
    toggleBasketPlot,
    clearBasket,
    setDirectBuyIds,
    optimisticPlots,
    clearOptimisticPlots,
    densityEnabled,
    eventCreateMode,
    setEventCreateMode,
    setEventDraft,
    setEventDrawerOpen,
    pushToast,
  } = store;

  const [tool, setTool] = useState<Tool>("pan");
  const [zoomLabel, setZoomLabel] = useState(1);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Camera & interaction state held in refs to avoid re-render on every frame.
  const cameraRef = useRef<Camera>({ camX: 0, camY: 0, scale: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const dirtyRef = useRef(true);
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;

  // Mirror basket / select-mode into refs so the imperative input + render
  // paths can read them without re-subscribing every frame.
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const eventCreateModeRef = useRef(eventCreateMode);
  eventCreateModeRef.current = eventCreateMode;
  const basketSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    basketSetRef.current = new Set(basket);
    dirtyRef.current = true;
  }, [basket]);

  // Event-creation flow: entering create mode switches to the Select tool so
  // the user can frame their region immediately.
  useEffect(() => {
    if (eventCreateMode) setTool("select");
  }, [eventCreateMode]);

  // When the event list changes (a new event was published / link edited),
  // force a redraw and rebuild reveal masks so the new region renders
  // immediately. Event image assets bake lazily through their own onload.
  const subscribeToEvents = useCallback(() => {
    return subscribeEvents(() => {
      eventMaskDirtyRef.current = true;
      dirtyRef.current = true;
      forceTick((t) => t + 1);
    });
  }, []);

  // Load created events on mount and re-render (and rebake masks) whenever
  // the list changes — e.g. right after a new event is published.
  useEffect(() => {
    void loadEvents();
    return subscribeToEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointerRef = useRef({
    down: false,
    dragging: false,
    panning: false,
    marquee: false,
    startSx: 0,
    startSy: 0,
    lastSx: 0,
    lastSy: 0,
    startCell: { x: 0, y: 0 },
    curCell: { x: 0, y: 0 },
  });
  const hoverCellRef = useRef<{ x: number; y: number } | null>(null);

  // Offscreen canvas for double-buffered compositing. All per-frame drawing
  // (plots, images, grid lines, overlays) targets this buffer; the visible
  // canvas only receives one drawImage blit per frame — eliminating the GPU
  // pipeline flush that per-element fillRect/clip/drawImage calls cause.
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Touch state for multi-touch gestures (mobile: 1-finger pan, 2-finger pinch).
  const touchRef = useRef({
    active: 0,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    // True once 2+ fingers ever touched during the current gesture — used to
    // suppress the accidental "tap" that fires when a pinch/pan gesture ends.
    multiTouch: false,
    // True while a single-finger drag in Select tool is drawing a marquee box.
    marquee: false,
    lastDist: 0,
    lastMidX: 0,
    lastMidY: 0,
  });

  // Loaded plot data for the current viewport + image cache.
  const plotMapRef = useRef<Map<number, Plot>>(new Map());
  // Contiguous-block membership for grid-line suppression. Keyed by plotId,
  // value = `${owner}|${blockIndex}`. Rebuilt when plot data changes.
  const plotBlockRef = useRef<Map<number, string>>(new Map());
  const plotBlockMembersRef = useRef<Map<string, number[]>>(new Map());
  const plotBlockDirtyRef = useRef(true);
  // Transaction-batch grouping for hover highlight. Populated by the
  // PlotsPurchased watcher so all plots bought in one tx are outlined together.
  // Maps plotId -> batchKey (`${owner}|${txHash}`).
  const purchaseBatchRef = useRef<Map<number, string>>(new Map());
  const purchaseBatchMembersRef = useRef<Map<string, number[]>>(new Map());
  const imageCacheRef = useRef<Map<string, HTMLImageElement | "error">>(
    new Map(),
  );
  const imageRetryRef = useRef<Map<string, { attempt: number; retryAt: number }>>(
    new Map(),
  );
  // Level-of-detail cache keyed by image content. Each entry holds a small
  // pre-downscaled thumbnail (aspect-preserved) plus the image's dominant
  // colour. Computed once per image (not per frame) — the render loop blits the
  // thumbnail stretched to fill the zone at low zoom, the full image at high
  // zoom, and a flat dominant-colour swatch when the zone is only a few pixels.
  const lodCacheRef = useRef<
    Map<string, { thumb: HTMLCanvasElement; dominant: string }>
  >(new Map());
  // Tracks which image URIs were painted in the most recent frame.  The image
  // and LOD caches use this to protect on-screen images from LRU eviction so
  // panning back never shows a flash while the image re-decodes.
  const visibleImageUrisRef = useRef<Set<string>>(new Set());

  // Event reveal state. Per event id: baked colour + grayscale twin
  // canvases, the source image element, and the owned-cell reveal mask.
  // The mask is rebuilt whenever plot data changes (same signal as the
  // contiguous-block rebuild). The scratch layer composites the colour reveal
  // before it is blitted, so the `destination-in` mask clip never touches the
  // board buffer (which would erase the ghost behind it).
  const eventAssetsRef = useRef<
    Map<string, { color: HTMLCanvasElement; gray: HTMLCanvasElement }>
  >(new Map());
  const eventImageRef = useRef<Map<string, HTMLImageElement | "error">>(
    new Map(),
  );
  const eventMaskRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const eventMaskDirtyRef = useRef(true);
  const eventLayerRef = useRef<HTMLCanvasElement | null>(null);
  const [, forceTick] = useState(0);
  const requestRedraw = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // -------------------------------------------------------------------
  // Coordinate helpers
  // -------------------------------------------------------------------
  const screenToCell = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: Math.floor(cam.camX + sx / cam.scale),
      y: Math.floor(cam.camY + sy / cam.scale),
    };
  }, []);

  const clampCamera = useCallback(() => {
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    const viewCellsX = width / cam.scale;
    const viewCellsY = height / cam.scale;
    // Allow a little overscroll margin so edges are reachable.
    cam.camX = clamp(cam.camX, -viewCellsX * 0.5, GRID_SIZE - viewCellsX * 0.5);
    cam.camY = clamp(cam.camY, -viewCellsY * 0.5, GRID_SIZE - viewCellsY * 0.5);
  }, []);

  const fitScale = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (!width || !height) return 1;
    return Math.max(MIN_SCALE_FLOOR, Math.min(width, height) / GRID_SIZE);
  }, []);

  /**
   * Center the entire 3162x3162 grid in the viewport and scale it so the whole
   * board fits with a small margin (so the blue frame is visible). Used for the
   * initial "welcome screen" load and the Reset button, on desktop and mobile.
   */
  const fitWholeBoard = useCallback(() => {
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const scale = Math.max(
      MIN_SCALE_FLOOR,
      (Math.min(width, height) / GRID_SIZE) * 0.92,
    );
    cam.scale = scale;
    cam.camX = GRID_SIZE / 2 - width / scale / 2;
    cam.camY = GRID_SIZE / 2 - height / scale / 2;
    setZoomLabel(cam.scale);
  }, []);

  // -------------------------------------------------------------------
  // Resize handling (DPR-aware)
  // -------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(rect.width * dpr);
      const h = Math.floor(rect.height * dpr);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // Keep the offscreen compositing buffer in sync with the visible canvas.
      let offscreen = offscreenRef.current;
      if (!offscreen) {
        offscreen = document.createElement("canvas");
        offscreenRef.current = offscreen;
      }
      if (offscreen.width !== w || offscreen.height !== h) {
        offscreen.width = w;
        offscreen.height = h;
      }

      // On first valid size, frame the whole board as a centered welcome view.
      const cam = cameraRef.current;
      if (cam.scale === 1 && cam.camX === 0 && cam.camY === 0) {
        fitWholeBoard();
      }
      dirtyRef.current = true;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitWholeBoard]);

  // -------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      renderBoard();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // -------------------------------------------------------------------
  // Contiguous-block computation for grid-line suppression.
  // Groups owned plots into 4-directionally-connected clusters by owner.
  // Only rebuilds when plot data actually changes, not every frame.
  // -------------------------------------------------------------------
  const computePlotBlocks = useCallback(() => {
    const map = plotMapRef.current;
    const blockMap = plotBlockRef.current;
    const membersMap = plotBlockMembersRef.current;
    blockMap.clear();
    membersMap.clear();
    const visited = new Set<number>();
    let nextBlockId = 0;

    for (const [plotId, plot] of map) {
      if (plot.owner.toLowerCase() === ZERO_ADDRESS) continue;
      if (visited.has(plotId)) continue;

      const owner = plot.owner.toLowerCase();
      const blockKey = `${owner}|${nextBlockId++}`;
      const queue = [plotId];
      visited.add(plotId);
      const members: number[] = [];

      while (queue.length) {
        const cur = queue.shift()!;
        blockMap.set(cur, blockKey);
        members.push(cur);
        const { x, y } = xyFromPlotId(cur);

        const neighbors: Array<[number, number]> = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const nid = plotIdFromXY(nx, ny);
          if (visited.has(nid)) continue;
          const nplot = map.get(nid);
          if (nplot && nplot.owner.toLowerCase() === owner) {
            visited.add(nid);
            queue.push(nid);
          }
        }
      }

      membersMap.set(blockKey, members);
    }

    plotBlockDirtyRef.current = false;
  }, []);

  const renderBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, dpr } = sizeRef.current;
    const cam = cameraRef.current;

    // Rebuild contiguous-block membership when plot data has changed. The
    // event reveal masks are rebuilt on the same signal.
    if (plotBlockDirtyRef.current) {
      computePlotBlocks();
      eventMaskDirtyRef.current = true;
    }

    // ----------------------------------------------------------------
    // Phase 1: Composite the static board layer onto the offscreen
    // buffer.  All per-element draw calls (fillRect per cell, drawImage
    // per group, clip per zone) target this non-displayed canvas, so
    // the GPU pipeline never flushes per-call to the display.
    // ----------------------------------------------------------------
    let offscreen = offscreenRef.current;
    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offscreenRef.current = offscreen;
    }
    const pixelW = Math.floor(width * dpr);
    const pixelH = Math.floor(height * dpr);
    if (offscreen.width !== pixelW || offscreen.height !== pixelH) {
      offscreen.width = pixelW;
      offscreen.height = pixelH;
    }
    const offCtx = offscreen.getContext("2d")!;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.clearRect(0, 0, pixelW, pixelH);
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Board background (pure white surface inside the frame).
    offCtx.fillStyle = "#ffffff";
    offCtx.fillRect(0, 0, width, height);

    // Visible cell range.
    const startX = Math.max(0, Math.floor(cam.camX));
    const startY = Math.max(0, Math.floor(cam.camY));
    const endX = Math.min(GRID_SIZE - 1, Math.ceil(cam.camX + width / cam.scale));
    const endY = Math.min(GRID_SIZE - 1, Math.ceil(cam.camY + height / cam.scale));

    const cellToScreenX = (cx: number) => (cx - cam.camX) * cam.scale;
    const cellToScreenY = (cy: number) => (cy - cam.camY) * cam.scale;

    // Faint board tint so the playable area reads as a canvas.
    const boardLeft = cellToScreenX(0);
    const boardTop = cellToScreenY(0);
    const boardSize = GRID_SIZE * cam.scale;
    offCtx.fillStyle = "#f8fbff";
    offCtx.fillRect(boardLeft, boardTop, boardSize, boardSize);

    // ---- Event ghost layer (grayscale preview over unowned regions) ----
    // Drawn BEFORE owned plots so bought cells (fills, user art, reveal) sit on
    // top of the ghost instead of being hidden underneath it.
    drawEventGhost(
      offCtx,
      cam,
      startX,
      startY,
      endX,
      endY,
      cellToScreenX,
      cellToScreenY,
      boardLeft,
      boardTop,
      boardSize,
    );

    // ---- Owned plots + stretched images (grouped by owner+uri) ----
    offCtx.save();
    offCtx.beginPath();
    offCtx.rect(boardLeft, boardTop, boardSize, boardSize);
    offCtx.clip();
    drawPlots(offCtx, cam, startX, startY, endX, endY, cellToScreenX, cellToScreenY);
    offCtx.restore();

    // ---- Event reveal (coloured pixels for owned cells) ----
    drawEventReveal(
      offCtx,
      cam,
      startX,
      startY,
      endX,
      endY,
      cellToScreenX,
      cellToScreenY,
      boardLeft,
      boardTop,
      boardSize,
      dpr,
    );

    // ---- Purchase-density overlay ----
    const densityField = densityCanvasRef.current;
    if (densityEnabledRef.current && densityField && densityField.width > 0) {
      offCtx.save();
      offCtx.beginPath();
      offCtx.rect(boardLeft, boardTop, boardSize, boardSize);
      offCtx.clip();
      const prevSmoothing = offCtx.imageSmoothingEnabled;
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = "high";
      offCtx.drawImage(densityField, boardLeft, boardTop, boardSize, boardSize);
      offCtx.imageSmoothingEnabled = prevSmoothing;
      offCtx.restore();
    }

    // ---- Grid border ----
    offCtx.save();
    offCtx.strokeStyle = "#0052ff";
    offCtx.lineWidth = 3;
    offCtx.strokeRect(
      boardLeft + 1.5,
      boardTop + 1.5,
      boardSize - 3,
      boardSize - 3,
    );
    offCtx.restore();

    // ---- Grid lines (fade in as zoom increases) ----
    const gridAlpha =
      cam.scale <= GRID_FADE_START
        ? 0
        : cam.scale >= GRID_FADE_FULL
          ? 1
          : (cam.scale - GRID_FADE_START) / (GRID_FADE_FULL - GRID_FADE_START);

    if (gridAlpha > 0.02) {
      offCtx.save();
      offCtx.strokeStyle = `rgba(59,130,246,${0.35 * gridAlpha})`;
      offCtx.lineWidth = 1;
      offCtx.beginPath();

      const blockMap = plotBlockRef.current;
      const vTop = Math.max(0, boardTop);
      const vBottom = Math.min(height, boardTop + boardSize);
      const hLeft = Math.max(0, boardLeft);
      const hRight = Math.min(width, boardLeft + boardSize);

      // Vertical lines — skip segments where both adjacent cells belong to
      // the same contiguous owned block (internal edges).
      for (let x = startX; x <= endX + 1; x++) {
        const sx = Math.round(cellToScreenX(x)) + 0.5;
        let segStart = vTop;
        for (let y = startY; y <= endY; y++) {
          const cellLeftId = plotIdFromXY(x - 1, y);
          const cellRightId = plotIdFromXY(x, y);
          const leftBlock = blockMap.get(cellLeftId);
          const rightBlock = blockMap.get(cellRightId);
          if (leftBlock && leftBlock === rightBlock) {
            const yTop = Math.round(cellToScreenY(y)) + 0.5;
            const yBot = Math.round(cellToScreenY(y + 1)) + 0.5;
            if (yTop > segStart) {
              offCtx.moveTo(sx, segStart);
              offCtx.lineTo(sx, yTop);
            }
            segStart = yBot;
          }
        }
        if (vBottom > segStart) {
          offCtx.moveTo(sx, segStart);
          offCtx.lineTo(sx, vBottom);
        }
      }

      // Horizontal lines — same logic: skip internal edges within a block.
      for (let y = startY; y <= endY + 1; y++) {
        const sy = Math.round(cellToScreenY(y)) + 0.5;
        let segStart = hLeft;
        for (let x = startX; x <= endX; x++) {
          const cellTopId = plotIdFromXY(x, y - 1);
          const cellBottomId = plotIdFromXY(x, y);
          const topBlock = blockMap.get(cellTopId);
          const bottomBlock = blockMap.get(cellBottomId);
          if (topBlock && topBlock === bottomBlock) {
            const xLeft = Math.round(cellToScreenX(x)) + 0.5;
            const xRight = Math.round(cellToScreenX(x + 1)) + 0.5;
            if (xLeft > segStart) {
              offCtx.moveTo(segStart, sy);
              offCtx.lineTo(xLeft, sy);
            }
            segStart = xRight;
          }
        }
        if (hRight > segStart) {
          offCtx.moveTo(segStart, sy);
          offCtx.lineTo(hRight, sy);
        }
      }

      offCtx.stroke();
      offCtx.restore();
    }

    // ---- Event region outline (thin, subtle frame) ----
    drawEventOutline(
      offCtx,
      cam,
      startX,
      startY,
      endX,
      endY,
      cellToScreenX,
      cellToScreenY,
    );

    // ---- Basket (tap-to-add multi-select) on the board layer ----
    const basketIds = basketSetRef.current;
    if (basketIds.size > 0) {
      offCtx.save();
      offCtx.fillStyle = "rgba(0,82,255,0.30)";
      offCtx.strokeStyle = "#0052ff";
      offCtx.lineWidth = Math.max(1, Math.min(3, cam.scale * 0.15));
      basketIds.forEach((id) => {
        const { x, y } = xyFromPlotId(id);
        if (x < startX - 1 || x > endX + 1 || y < startY - 1 || y > endY + 1)
          return;
        const sx = cellToScreenX(x);
        const sy = cellToScreenY(y);
        offCtx.fillRect(sx, sy, cam.scale, cam.scale);
        if (cam.scale > 3) offCtx.strokeRect(sx, sy, cam.scale, cam.scale);
      });
      offCtx.restore();
    }

    // ----------------------------------------------------------------
    // Phase 2: Blit the composited board onto the visible canvas with
    // one GPU-composited drawImage call.
    // ----------------------------------------------------------------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(offscreen, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ----------------------------------------------------------------
    // Phase 3: Dynamic overlays drawn directly on the visible canvas
    // (hover highlight, marquee selection).  These are cheap — a few
    // rects — so they don't need the offscreen pass.
    // ----------------------------------------------------------------

    // ---- Hover highlight (transaction-batch aware) ----
    const hov = hoverCellRef.current;
    if (hov && cam.scale > 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,82,255,0.9)";
      ctx.lineWidth = 2;
      const hovId = plotIdFromXY(hov.x, hov.y);
      // Prefer purchase batch grouping (plots bought together in one tx).
      // Fall back to contiguous block grouping for older plots.
      const batchKey = purchaseBatchRef.current.get(hovId);
      const hovMembers = batchKey
        ? (purchaseBatchMembersRef.current.get(batchKey) ?? null)
        : null;
      const outlineMembers = hovMembers ?? (() => {
        const bk = plotBlockRef.current.get(hovId);
        return bk ? (plotBlockMembersRef.current.get(bk) ?? null) : null;
      })();
      if (outlineMembers) {
        const outlineSet = new Set(outlineMembers);
        ctx.beginPath();
        for (const id of outlineMembers) {
          const { x, y } = xyFromPlotId(id);
          const l = Math.round(cellToScreenX(x)) + 0.5;
          const t = Math.round(cellToScreenY(y)) + 0.5;
          const r = Math.round(cellToScreenX(x + 1)) + 0.5;
          const b = Math.round(cellToScreenY(y + 1)) + 0.5;
          const tId = plotIdFromXY(x, y - 1);
          const rId = plotIdFromXY(x + 1, y);
          const bId = plotIdFromXY(x, y + 1);
          const lId = plotIdFromXY(x - 1, y);
          if (!outlineSet.has(tId)) { ctx.moveTo(l, t); ctx.lineTo(r, t); }
          if (!outlineSet.has(rId)) { ctx.moveTo(r, t); ctx.lineTo(r, b); }
          if (!outlineSet.has(bId)) { ctx.moveTo(l, b); ctx.lineTo(r, b); }
          if (!outlineSet.has(lId)) { ctx.moveTo(l, t); ctx.lineTo(l, b); }
        }
        ctx.stroke();
      } else {
        ctx.strokeRect(
          Math.round(cellToScreenX(hov.x)) + 0.5,
          Math.round(cellToScreenY(hov.y)) + 0.5,
          cam.scale,
          cam.scale,
        );
      }
      ctx.restore();
    }

    // ---- Marquee selection rectangle ----
    const p = pointerRef.current;
    if (p.marquee) {
      const x1 = clamp(Math.min(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
      const y1 = clamp(Math.min(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
      const x2 = clamp(Math.max(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
      const y2 = clamp(Math.max(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
      const rx = cellToScreenX(x1);
      const ry = cellToScreenY(y1);
      const rw = (x2 - x1 + 1) * cam.scale;
      const rh = (y2 - y1 + 1) * cam.scale;
      ctx.save();
      ctx.fillStyle = "rgba(0,82,255,0.18)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = "#0052ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();

      // ---- Marquee cell-count labels ----
      const cols = x2 - x1 + 1;
      const rows = y2 - y1 + 1;
      const fontSize = Math.max(11, Math.min(18, cam.scale * 0.6));
      ctx.save();
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const labelPad = 6;
      let wx = rx + rw / 2;
      let wy = ry - labelPad;
      if (wy < 0) wy = ry + labelPad;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeText(String(cols), wx, wy);
      ctx.fillStyle = "#0052ff";
      ctx.fillText(String(cols), wx, wy);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      let hx = rx - labelPad;
      let hy = ry + rh / 2;
      if (hx < 0) hx = rx + labelPad;
      ctx.textAlign = "right";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeText(String(rows), hx, hy);
      ctx.fillStyle = "#0052ff";
      ctx.fillText(String(rows), hx, hy);
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Draw owned plots: group contiguous same owner+uri rectangles so a single
  // image is stretched across a purchased zone instead of tiled per cell.
  const drawPlots = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cam: Camera,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      cellToScreenX: (c: number) => number,
      cellToScreenY: (c: number) => number,
    ) => {
      const map = plotMapRef.current;
      if (map.size === 0) return;

      const me = address?.toLowerCase();
      // Always render images at every zoom level — even fully zoomed out, where
      // a multi-plot billboard shrinks to a few pixels. (Previously gated behind
      // IMAGE_MIN_SCALE, which made artwork vanish on zoom-out.) The expensive
      // per-cell clip is only used when zoomed in enough to matter; when zoomed
      // out we draw across the span bbox for cheapness.
      const drawImages = true;
      const preciseClip = cam.scale >= IMAGE_MIN_SCALE;



      // Bucket loaded plots by `${owner}|${imageUri}`. An image reference may
      // carry a `#bb=x1,y1,x2,y2` zone fragment telling us to span a multi-plot
      // area from a single anchor plot (one transaction). Otherwise the span is
      // the bounding box of every cell that shares the same image (legacy multi).
      type Group = {
        owner: string;
        uri: string;
        zone: { x1: number; y1: number; x2: number; y2: number } | null;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        cells: Array<{ x: number; y: number }>;
      };
      const groups = new Map<string, Group>();

      map.forEach((plot, id) => {
        if (plot.owner.toLowerCase() === ZERO_ADDRESS) return;
        const { x, y } = xyFromPlotId(id);
        const visible = !(
          x < startX - 1 ||
          x > endX + 1 ||
          y < startY - 1 ||
          y > endY + 1
        );

        // Base fill per cell — only for on-screen cells. Enforce a minimum
        // on-screen marker size so owned / for-sale plots stay visible at any
        // zoom level — including fully zoomed out, where a single cell would
        // otherwise be sub-pixel.
        // Skip for cells with an image: the image draw pass paints over them
        // completely, and a blue rect underneath can show through at certain
        // zoom levels due to sub-pixel gaps between the fill and the clip rect.
        if (visible && !plot.imageUri) {
          const isMine = me && plot.owner.toLowerCase() === me;
          const sx = Math.floor(cellToScreenX(x));
          const sy = Math.floor(cellToScreenY(y));
          const zoomedOut = cam.scale < IMAGE_MIN_SCALE;
          // Exact pixel-aligned cell size.  Add 1 px at extreme zoom (< 0.5) so
          // isolated owned cells aren't invisible dots; overlaps are harmless
          // because image icons (drawn on top) are always larger.
          const marker = Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0);
          ctx.fillStyle = plot.isForSale
            ? zoomedOut
              ? "#0052ff"
              : "#3b82f6"
            : isMine
              ? "#1d4ed8"
              : zoomedOut
                ? "#3b82f6"
                : "#60a5fa";
          ctx.fillRect(sx, sy, marker, marker);
        }

        // Build image groups for EVERY loaded image plot regardless of whether
        // its own anchor cell is currently on-screen. A multi-plot billboard's
        // anchor (which carries the zone fragment) is often just off the visible
        // edge while most of the artwork is still in view — culling here is what
        // made perimeter images vanish during pan/zoom. We cull whole groups at
        // draw time by their span bbox instead.
        if (plot.imageUri) {
          // Event regions: hide any artwork that isn't the event's own
          // image — bought cells there may only ever show the reveal colour.
          const eventRegion = getEventForCell(x, y);
          if (eventRegion && stripZone(plot.imageUri) !== eventRegion.imagePath) {
            return;
          }
          // Key on owner + image *content* (zone fragment stripped) so the SAME
          // artwork applied across separately-purchased adjacent batches stitches
          // into one unified billboard instead of fragmenting per batch.
          const key = `${plot.owner.toLowerCase()}|${stripZone(plot.imageUri)}`;
          const zone = parseZone(plot.imageUri);
          const g = groups.get(key);
          if (g) {
            g.x1 = Math.min(g.x1, x);
            g.y1 = Math.min(g.y1, y);
            g.x2 = Math.max(g.x2, x);
            g.y2 = Math.max(g.y2, y);
            g.cells.push({ x, y });
            // Union any zone so a multi-anchor billboard spans the full area.
            if (zone) {
              if (g.zone) {
                g.zone.x1 = Math.min(g.zone.x1, zone.x1);
                g.zone.y1 = Math.min(g.zone.y1, zone.y1);
                g.zone.x2 = Math.max(g.zone.x2, zone.x2);
                g.zone.y2 = Math.max(g.zone.y2, zone.y2);
              } else {
                g.zone = zone;
              }
            }
          } else {
            groups.set(key, {
              owner: plot.owner.toLowerCase(),
              uri: plot.imageUri,
              zone,
              x1: x,
              y1: y,
              x2: x,
              y2: y,
              cells: [{ x, y }],
            });
          }
        }
      });

      // Draw one image per group, stretched (object-fit: fill) across its span.
      // Above a threshold of visible groups we always use the cheap LOD
      // thumbnail so a dense board never stalls the frame.
      if (drawImages) {
        const manyGroups = groups.size > LOD_FULL_MAX_GROUPS;

        // First pass: find the largest visible group span so icon-mode sizes
        // scale proportionally — 1×1 groups get the smallest icon, the biggest
        // visible group gets the largest icon.
        let maxIconSpan = 1;
        groups.forEach((g) => {
          const img = getImage(g.uri);
          if (!img || img === "error" || !img.complete || img.naturalWidth === 0)
            return;
          const bx1 = g.zone ? g.zone.x1 : g.x1;
          const by1 = g.zone ? g.zone.y1 : g.y1;
          const bx2 = g.zone ? g.zone.x2 : g.x2;
          const by2 = g.zone ? g.zone.y2 : g.y2;
          if (
            bx2 < startX - 1 ||
            bx1 > endX + 1 ||
            by2 < startY - 1 ||
            by1 > endY + 1
          )
            return;
          const cw = bx2 - bx1 + 1;
          const ch = by2 - by1 + 1;
          maxIconSpan = Math.max(maxIconSpan, Math.min(cw, ch));
        });

        groups.forEach((g) => {
          // Span: explicit zone bbox, else the cells sharing this image.
          const bx1 = g.zone ? g.zone.x1 : g.x1;
          const by1 = g.zone ? g.zone.y1 : g.y1;
          const bx2 = g.zone ? g.zone.x2 : g.x2;
          const by2 = g.zone ? g.zone.y2 : g.y2;

          // Cull whole groups by their span bbox, not by anchor cell — so a
          // billboard whose anchor is just off-screen still renders as long as
          // any part of its area intersects the viewport.
          if (
            bx2 < startX - 1 ||
            bx1 > endX + 1 ||
            by2 < startY - 1 ||
            by1 > endY + 1
          )
            return;

          const img = getImage(g.uri);
          if (!img || img === "error" || !img.complete || img.naturalWidth === 0) {
            // Image not ready — draw a fallback coloured fill so the cell
            // isn't invisible (white-on-white) while the image loads.
            const isMine = g.owner === me;
            ctx.fillStyle = isMine ? "#1d4ed8" : "#60a5fa";
            for (const c of g.cells) {
              ctx.fillRect(
                Math.floor(cellToScreenX(c.x)),
                Math.floor(cellToScreenY(c.y)),
                Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
                Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
              );
            }
            return;
          }

          // Floor the start and ceil the span so the image rect covers every
          // pixel that any part of the cells touch — no sub-pixel gaps.
          const dx = Math.floor(cellToScreenX(bx1));
          const dy = Math.floor(cellToScreenY(by1));
          const w = Math.ceil((bx2 - bx1 + 1) * cam.scale);
          const h = Math.ceil((by2 - by1 + 1) * cam.scale);

          ctx.save();

          const lod = getLod(g.uri, img);

          // At extreme zoom the bbox is just a few pixels — use the
          // proportionally-sized icon mode (no cell clip) so that large
          // vs small blocks are visually distinct. At closer zoom we
          // clip to the individual cells to prevent image bleed into
          // empty gaps between non‑contiguous plots.
          const extremeZoom = w < MIN_ICON_PX && h < MIN_ICON_PX;

          if (!extremeZoom) {
            // First clip to the exact zone/cell bbox to prevent any
            // sub-pixel anti-aliasing bleed at low zoom levels.
            ctx.beginPath();
            ctx.rect(dx, dy, w, h);
            ctx.clip();

            // Second clip to the individual owned cells so the image
            // never bleeds onto empty gaps.
            ctx.beginPath();
            if (g.zone) {
              let clipped = 0;
              for (let cz = by1; cz <= by2; cz++) {
                for (let cx = bx1; cx <= bx2; cx++) {
                  const cellId = cz * GRID_SIZE + cx;
                  const cell = map.get(cellId);
                  if (!cell) continue;
                  if (cell.owner.toLowerCase() !== g.owner) continue;
                  if (cell.imageUri) {
                    const cellZone = parseZone(cell.imageUri);
                    if (cellZone && (cellZone.x1 !== bx1 || cellZone.y1 !== by1)) continue;
                  }
                  ctx.rect(
                    Math.floor(cellToScreenX(cx)),
                    Math.floor(cellToScreenY(cz)),
                    Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
                    Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
                  );
                  clipped++;
                }
              }
              if (clipped === 0) {
                ctx.restore();
                dirtyRef.current = true;
                return;
              }
            } else {
              g.cells.forEach((c) => {
                ctx.rect(
                  Math.floor(cellToScreenX(c.x)),
                  Math.floor(cellToScreenY(c.y)),
                  Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
                  Math.ceil(cam.scale) + (cam.scale < 0.5 ? 1 : 0),
                );
              });
            }
            ctx.clip();
          }

          // Icon-mode preview (proportional) at extreme zoom — single
          // icon at bbox centre.  At closer zoom draw across the full
          // bbox; the cell clip handles the rest.
          if (extremeZoom) {
            const cw = bx2 - bx1 + 1;
            const ch = by2 - by1 + 1;
            const span = Math.min(cw, ch);
            const t = maxIconSpan > 1 ? (span - 1) / (maxIconSpan - 1) : 0;
            const iconSize = Math.round(MIN_ICON_PX + t * (MAX_ICON_PX - MIN_ICON_PX));
            const src = lod ? lod.thumb : img;
            ctx.drawImage(src, dx + (w - iconSize) / 2, dy + (h - iconSize) / 2, iconSize, iconSize);
          } else {
            try {
              const useFull = preciseClip && !manyGroups;
              const src = useFull || !lod ? img : lod.thumb;
              ctx.drawImage(src, dx, dy, w, h);
            } catch {
              /* tainted/broken image — fill already drawn underneath */
            }
          }
          ctx.restore();
        });
      }

      // Persist the set of image URIs that were painted this frame so the
      // image and LOD caches can skip evicting on-screen images.
      {
        const nextUris = new Set<string>();
        groups.forEach((g) => {
          const bx1 = g.zone ? g.zone.x1 : g.x1;
          const by1 = g.zone ? g.zone.y1 : g.y1;
          const bx2 = g.zone ? g.zone.x2 : g.x2;
          const by2 = g.zone ? g.zone.y2 : g.y2;
          if (bx2 < startX - 1 || bx1 > endX + 1 || by2 < startY - 1 || by1 > endY + 1) return;
          nextUris.add(stripZone(g.uri));
        });
        visibleImageUrisRef.current = nextUris;
      }

    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address],
  );

  // -------------------------------------------------------------------
  // Event reveal layers (grayscale ghost + owned-cell colour reveal)
  // -------------------------------------------------------------------

  /** Load (and cache) a event image; returns null until decoded. */
  const loadEventImage = useCallback((path: string) => {
    const cache = eventImageRef.current;
    let img = cache.get(path);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        dirtyRef.current = true;
      };
      img.onerror = () => {
        cache.set(path, "error");
        dirtyRef.current = true;
      };
      img.src = path;
      cache.set(path, img);
    }
    return img === "error" ? null : img;
  }, []);

  /**
   * Bake (once, per event) the full-colour canvas and its grayscale twin.
   * Same-origin /public assets never taint the canvas, so per-pixel reads work.
   */
  const getEventAssets = useCallback(
    (c: EventReveal) => {
      const cached = eventAssetsRef.current.get(c.id);
      if (cached) return cached;

      const img = loadEventImage(c.imagePath);
      if (!img || !img.complete || img.naturalWidth === 0) return null;

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const ratio = Math.min(1, EVENT_BAKE_MAX_DIM / Math.max(iw, ih));
      const cw = Math.max(1, Math.round(iw * ratio));
      const ch = Math.max(1, Math.round(ih * ratio));

      const color = document.createElement("canvas");
      color.width = cw;
      color.height = ch;
      const cctx = color.getContext("2d", { willReadFrequently: true });
      if (!cctx) return null;
      cctx.drawImage(img, 0, 0, iw, ih, 0, 0, cw, ch);

      const gray = document.createElement("canvas");
      gray.width = cw;
      gray.height = ch;
      const gctx = gray.getContext("2d");
      if (!gctx) return null;
      gctx.drawImage(color, 0, 0);
      try {
        const id = gctx.getImageData(0, 0, cw, ch);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = luma;
        }
        gctx.putImageData(id, 0, 0);
      } catch {
        // Tainted canvas (unexpected for same-origin assets) — keep the colour
        // copy so the ghost still has something to draw.
      }

      const entry = { color, gray };
      eventAssetsRef.current.set(c.id, entry);
      return entry;
    },
    [loadEventImage],
  );

  /**
   * Rebuild (when plot data changed) the per-event reveal mask: a
   * cell-sized canvas that is opaque white for every owned plot in the region
   * and transparent elsewhere. Combined with `destination-in` this clips the
   * colour layer to exactly the bought cells — the "colour reveal".
   */
  const getEventMask = useCallback((c: EventReveal) => {
    let mask = eventMaskRef.current.get(c.id);
    if (mask && !eventMaskDirtyRef.current) return mask;
    if (!mask) {
      mask = document.createElement("canvas");
      mask.width = c.x2 - c.x1 + 1;
      mask.height = c.y2 - c.y1 + 1;
      eventMaskRef.current.set(c.id, mask);
    }
    const mctx = mask.getContext("2d");
    if (!mctx) return mask;
    mctx.clearRect(0, 0, mask.width, mask.height);
    const map = plotMapRef.current;
    mctx.fillStyle = "#ffffff";
    for (let y = c.y1; y <= c.y2; y++) {
      for (let x = c.x1; x <= c.x2; x++) {
        const plot = map.get(plotIdFromXY(x, y));
        if (plot && plot.owner.toLowerCase() !== ZERO_ADDRESS) {
          mctx.fillRect(x - c.x1, y - c.y1, 1, 1);
        }
      }
    }
    eventMaskDirtyRef.current = false;
    return mask;
  }, []);

  /** Draw the grayscale ghost layer for every event in the viewport. */
  const drawEventGhost = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cam: Camera,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      cellToScreenX: (c: number) => number,
      cellToScreenY: (c: number) => number,
      boardLeft: number,
      boardTop: number,
      boardSize: number,
    ) => {
      for (const c of getEvents()) {
        if (
          c.x2 < startX - 1 ||
          c.x1 > endX + 1 ||
          c.y2 < startY - 1 ||
          c.y1 > endY + 1
        )
          continue;
        const assets = getEventAssets(c);
        if (!assets) continue;
        const dx = Math.floor(cellToScreenX(c.x1));
        const dy = Math.floor(cellToScreenY(c.y1));
        const w = Math.ceil((c.x2 - c.x1 + 1) * cam.scale);
        const h = Math.ceil((c.y2 - c.y1 + 1) * cam.scale);

        ctx.save();
        ctx.beginPath();
        ctx.rect(boardLeft, boardTop, boardSize, boardSize);
        ctx.clip();
        ctx.globalAlpha = c.ghostAlpha;
        ctx.drawImage(assets.gray, dx, dy, w, h);
        ctx.restore();
      }
    },
    [getEventAssets],
  );

  /** Draw the coloured reveal for owned cells inside each event region. */
  const drawEventReveal = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cam: Camera,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      cellToScreenX: (c: number) => number,
      cellToScreenY: (c: number) => number,
      boardLeft: number,
      boardTop: number,
      boardSize: number,
      dpr: number,
    ) => {
      for (const c of getEvents()) {
        if (
          c.x2 < startX - 1 ||
          c.x1 > endX + 1 ||
          c.y2 < startY - 1 ||
          c.y1 > endY + 1
        )
          continue;
        const assets = getEventAssets(c);
        if (!assets) continue;
        const mask = getEventMask(c);
        if (!mask) continue;

        const dx = Math.floor(cellToScreenX(c.x1));
        const dy = Math.floor(cellToScreenY(c.y1));
        const w = Math.ceil((c.x2 - c.x1 + 1) * cam.scale);
        const h = Math.ceil((c.y2 - c.y1 + 1) * cam.scale);
        if (w <= 0 || h <= 0) continue;

        // The scratch layer is resolution-capped so deep zoom (scale 48 →
        // ~9600px region) can't allocate a multi-gigabyte canvas; event
        // sources are ~2px/cell anyway, so nothing sharp is lost.
        const layerScale = Math.min(1, EVENT_LAYER_MAX_DIM / Math.max(w, h));
        const lw = Math.max(1, Math.round(w * layerScale));
        const lh = Math.max(1, Math.round(h * layerScale));

        let layer = eventLayerRef.current;
        if (!layer) {
          layer = document.createElement("canvas");
          eventLayerRef.current = layer;
        }
        if (layer.width !== lw || layer.height !== lh) {
          layer.width = lw;
          layer.height = lh;
        }
        const lctx = layer.getContext("2d");
        if (!lctx) continue;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, lw, lh);
        lctx.imageSmoothingEnabled = true;
        lctx.imageSmoothingQuality = "high";
        lctx.drawImage(assets.color, 0, 0, lw, lh);
        // Clip the colour layer to exactly the bought cells (white = owned).
        // Smoothing is off so cell boundaries stay pixel-exact.
        lctx.globalCompositeOperation = "destination-in";
        lctx.imageSmoothingEnabled = false;
        lctx.drawImage(mask, 0, 0, lw, lh);
        lctx.globalCompositeOperation = "source-over";

        ctx.save();
        ctx.beginPath();
        ctx.rect(boardLeft, boardTop, boardSize, boardSize);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(layer, dx, dy, w, h);
        ctx.restore();
      }
    },
    [getEventAssets, getEventMask],
  );

  /** Draw a thin, subtle frame around each event region. */
  const drawEventOutline = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cam: Camera,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      cellToScreenX: (c: number) => number,
      cellToScreenY: (c: number) => number,
    ) => {
      for (const c of getEvents()) {
        if (
          c.x2 < startX - 1 ||
          c.x1 > endX + 1 ||
          c.y2 < startY - 1 ||
          c.y1 > endY + 1
        )
          continue;
        const dx = cellToScreenX(c.x1);
        const dy = cellToScreenY(c.y1);
        const w = (c.x2 - c.x1 + 1) * cam.scale;
        const h = (c.y2 - c.y1 + 1) * cam.scale;

        ctx.save();
        ctx.strokeStyle = c.outlineColor;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = Math.max(1, Math.min(2, cam.scale * 0.05));
        ctx.strokeRect(dx + 0.5, dy + 0.5, w - 1, h - 1);
        ctx.restore();
      }
    },
    [],
  );

  const getImage = useCallback(
    (uri: string): HTMLImageElement | "error" | null => {
      const cache = imageCacheRef.current;
      const key = stripZone(uri);
      const existing = cache.get(key);
      if (existing) {
        if (existing !== "error") return existing;
        const retryEntry = imageRetryRef.current.get(key);
        if (retryEntry && retryEntry.retryAt > Date.now()) return "error";
        cache.delete(key);
        imageRetryRef.current.delete(key);
      }

      const retryEntry = imageRetryRef.current.get(key);
      const attempt = retryEntry ? retryEntry.attempt + 1 : 0;
      const TIMEOUT_MS = 8_000;

      const img = new Image();
      img.crossOrigin = "anonymous";
      let timedOut = false;
      let handleErrorCalled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Setting src to '' triggers onerror synchronously in some browsers,
        // so mark handleErrorCalled BEFORE clearing src to prevent double-call.
        handleErrorCalled = true;
        handleError();
      }, TIMEOUT_MS);

      const handleError = () => {
        if (handleErrorCalled) return;
        handleErrorCalled = true;
        clearTimeout(timer);
        if (attempt < 3 && (uri.startsWith("ipfs://") || /^[a-zA-Z0-9]{46,}$/.test(uri))) {
          const delays = [5_000, 15_000, 30_000];
          const delay = delays[Math.min(attempt, delays.length - 1)];
          imageRetryRef.current.set(key, { attempt, retryAt: Date.now() + delay });
          cache.set(key, "error");
          setTimeout(() => {
            dirtyRef.current = true;
          }, delay);
        } else {
          cache.set(key, "error");
          imageRetryRef.current.delete(key);
        }
        dirtyRef.current = true;
      };

      img.onload = () => {
        if (timedOut) return;
        clearTimeout(timer);
        if (cache.get(key) === img || cache.get(key) === "error") {
          cache.set(key, img);
        }
        imageRetryRef.current.delete(key);
        dirtyRef.current = true;
      };
      img.onerror = () => {
        if (!timedOut) handleError();
      };
      const gatewayIdx = Math.min(attempt, IPFS_GATEWAYS.length - 1);
      img.src = resolveUri(key, gatewayIdx);
      cache.set(key, img);
      if (cache.size > IMAGE_CACHE_MAX) {
        const visible = visibleImageUrisRef.current;
        let evicted = 0;
        for (const k of cache.keys()) {
          if (evicted >= 5) break;
          if (!visible.has(k)) {
            cache.delete(k);
            imageRetryRef.current.delete(k);
            evicted++;
          }
        }
      }
      return img;
    },
    [],
  );

  /**
   * Build (once, then cache) the level-of-detail entry for an image: a small
   * aspect-preserved thumbnail plus the image's dominant colour. The thumbnail
   * keeps the source's own proportions, so blitting it *stretched* to a zone
   * yields the same object-fit: fill result as stretching the full image, just
   * cheaper. Returns null until the source has finished decoding.
   */
  const getLod = useCallback(
    (
      uri: string,
      img: HTMLImageElement,
    ): { thumb: HTMLCanvasElement; dominant: string } | null => {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return null;
      const key = stripZone(uri);
      const cache = lodCacheRef.current;
      const hit = cache.get(key);
      if (hit) return hit;

      // Thumbnail: longest side capped at LOD_THUMB_DIM, aspect preserved.
      const ratio = Math.min(1, LOD_THUMB_DIM / Math.max(iw, ih));
      const tw = Math.max(1, Math.round(iw * ratio));
      const th = Math.max(1, Math.round(ih * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const c = canvas.getContext("2d");
      if (!c) return null;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(img, 0, 0, iw, ih, 0, 0, tw, th);

      // Dominant colour: average the thumbnail down to 1×1. Cross-origin images
      // without CORS taint the canvas and throw on read — fall back to a neutral
      // Base-blue tint so the swatch path still has something to paint.
      let dominant = "#9bbcf2";
      try {
        const one = document.createElement("canvas");
        one.width = one.height = 1;
        const oc = one.getContext("2d", { willReadFrequently: true });
        if (oc) {
          oc.drawImage(canvas, 0, 0, tw, th, 0, 0, 1, 1);
          const [r, g, b] = oc.getImageData(0, 0, 1, 1).data;
          dominant = `rgb(${r}, ${g}, ${b})`;
        }
      } catch {
        /* tainted canvas — keep the neutral fallback */
      }

      const entry = { thumb: canvas, dominant };
      cache.set(key, entry);
      // Evict non-visible LOD entries so off-screen images' previews are
      // reclaimed while on-screen ones stay hot.  Uses the same visible-URI set
      // as the image cache, keyed by the zone-stripped content address.
      if (cache.size > LOD_CACHE_MAX) {
        const visible = visibleImageUrisRef.current;
        let evicted = 0;
        for (const k of cache.keys()) {
          if (evicted >= 5) break;
          if (!visible.has(k)) {
            cache.delete(k);
            evicted++;
          }
        }
      }
      return entry;
    },
    [],
  );

  /**
   * Pre-decode images into the shared cache so the render loop never waits
   * for a lazy load. Called after every Turso fetch so new images are ready
   * on the very first frame they appear.
   *
   * Each request has a 30-second timeout so stalled IPFS gateways are
   * retried on the next gateway instead of hanging indefinitely.
   */
  const preloadImages = useCallback(
    (plots: Record<number, { imageUri: string }>) => {
      const cache = imageCacheRef.current;
      const TIMEOUT_MS = 8_000;
      let seq = 0;
      for (const plot of Object.values(plots)) {
        const uri = plot.imageUri;
        if (!uri) continue;
        const key = stripZone(uri);
        if (cache.has(key)) continue;
        const gatewayIdx = seq++ % IPFS_GATEWAYS.length;
        const tryGateway = (g: number) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            img.src = "";
            const next = g + 1;
            if (next < IPFS_GATEWAYS.length) {
              tryGateway(next);
            } else {
              cache.set(key, "error");
              dirtyRef.current = true;
            }
          }, TIMEOUT_MS);
          img.onload = () => {
            clearTimeout(timer);
            if (!timedOut) {
              cache.set(key, img);
              dirtyRef.current = true;
            }
          };
          img.onerror = () => {
            clearTimeout(timer);
            if (!timedOut) {
              const next = g + 1;
              if (next < IPFS_GATEWAYS.length) {
                tryGateway(next);
              } else {
                cache.set(key, "error");
                dirtyRef.current = true;
              }
            }
          };
          img.src = resolveUri(key, g);
          cache.set(key, img);
        };
        tryGateway(gatewayIdx);
      }
    },
    [],
  );

  // -------------------------------------------------------------------
  // Purchase-density overlay state (Part 10.2)

  // ---- Purchase-density overlay state (Part 10.2) ----
  // Block at which each plot was last seen purchased (drives the recency
  // window), the latest scanned block, and a low-res baked density field that
  // renderBoard stretches over the board as a soft additive blue tint.
  const purchaseBlockRef = useRef<Map<number, number>>(new Map());
  const latestBlockRef = useRef<number>(0);
  const densityCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Heatmap on/off. Mirrored into a ref so the render loop reads it without
  // re-creating `renderBoard`. When off we neither bake nor draw the field.
  // (The on/off sync effect lives just after `bakeDensity` is defined below.)
  const densityEnabledRef = useRef(densityEnabled);

  // Rebuild the baked density field from the current owned plots. Each owned
  // plot contributes to its coarse bucket; recent purchases (within
  // DENSITY_RECENT_WINDOW_BLOCKS of the latest block) are counted when there is
  // enough recent activity, otherwise we fall back to the all-time field. The
  // BUCKETS×BUCKETS field is normalized and written as per-pixel blue alpha so a
  // single smooth-scaled drawImage produces the gradient (never recolouring the
  // pixels themselves — this is a translucent layer on top).
  const bakeDensity = useCallback(() => {
    const map = plotMapRef.current;
    const B = DENSITY_BUCKETS;
    const recentThreshold = latestBlockRef.current - DENSITY_RECENT_WINDOW_BLOCKS;
    const recent = new Float32Array(B * B);
    const allTime = new Float32Array(B * B);
    let recentCount = 0;
    map.forEach((_plot, id) => {
      const { x, y } = xyFromPlotId(id);
      const bx = Math.min(B - 1, Math.floor((x / GRID_SIZE) * B));
      const by = Math.min(B - 1, Math.floor((y / GRID_SIZE) * B));
      const idx = by * B + bx;
      allTime[idx] += 1;
      const blk = purchaseBlockRef.current.get(id) ?? 0;
      if (blk >= recentThreshold) {
        recent[idx] += 1;
        recentCount += 1;
      }
    });
    const field = recentCount >= DENSITY_RECENT_MIN ? recent : allTime;
    let max = 0;
    for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];

    let off = densityCanvasRef.current;
    if (!off) {
      off = document.createElement("canvas");
      densityCanvasRef.current = off;
    }
    off.width = B;
    off.height = B;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.clearRect(0, 0, B, B);
    if (max <= 0) return;
    const img = octx.createImageData(B, B);
    for (let i = 0; i < field.length; i++) {
      // Gamma softens the falloff so mid-density regions remain visible.
      const level = Math.pow(field[i] / max, 0.6);
      img.data[i * 4] = DENSITY_RGB.r;
      img.data[i * 4 + 1] = DENSITY_RGB.g;
      img.data[i * 4 + 2] = DENSITY_RGB.b;
      img.data[i * 4 + 3] = Math.round(level * DENSITY_ALPHA_CAP * 255);
    }
    octx.putImageData(img, 0, 0);
  }, []);

  // Keep the render-loop ref in sync with the toggle and bake on first enable.
  useEffect(() => {
    densityEnabledRef.current = densityEnabled;
    if (densityEnabled && !densityCanvasRef.current) bakeDensity();
    dirtyRef.current = true;
  }, [densityEnabled, bakeDensity]);

  // -------------------------------------------------------------------
  // Real-time PlotsPurchased event watcher (incremental updates)
  // -------------------------------------------------------------------
  useWatchContractEvent({
    address: cfg.isConfigured ? cfg.contract : undefined,
    abi: baseBoardAbi,
    eventName: "PlotsPurchased",
    onLogs(logs: Array<{ args?: { plotIds?: readonly bigint[] }; blockNumber?: bigint; transactionHash?: string }>) {
      if (logs.length === 0) return;
      const batchMap = purchaseBatchRef.current;
      const batchMembersMap = purchaseBatchMembersRef.current;
      const newPlotIds: number[] = [];
      logs.forEach((log) => {
        const args = log.args as { plotIds?: readonly bigint[] };
        const txHash = log.transactionHash || String(log.blockNumber ?? 0n);
        args.plotIds?.forEach((b) => {
          const id = Number(b);
          newPlotIds.push(id);
          purchaseBlockRef.current.set(id, Number(log.blockNumber ?? 0n));
        });
        // Group all plots from this tx into one batch for hover highlight.
        // Owner will be filled from chain response below.
        if (args.plotIds && args.plotIds.length > 0) {
          const plotIds = args.plotIds.map(Number);
          for (const id of plotIds) {
            batchMap.set(id, `pending|${txHash}`);
          }
        }
      });
      if (newPlotIds.length === 0) return;
      // Batch-read just the newly purchased plots from chain.
      if (!publicClient) return;
      void (async () => {
        let result: readonly Plot[] | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = (await readContractWithTimeout(
              publicClient.readContract({
                address: cfg.contract,
                abi: baseBoardAbi,
                functionName: "getPlotsBatch",
                args: [newPlotIds.map((n) => BigInt(n))],
              }),
            )) as readonly Plot[];
            break;
          } catch (e) {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            else console.error("Watcher: getPlotsBatch failed after 3 retries", e);
          }
        }
        if (!result) return;
        const map = plotMapRef.current;
        result.forEach((plot, i) => {
          const id = newPlotIds[i];
          if (plot.owner.toLowerCase() !== ZERO_ADDRESS) map.set(id, plot);
          else map.delete(id);
        });
        plotBlockDirtyRef.current = true;
        // Update purchase batch entries with actual owner
        const batchMembersMap = purchaseBatchMembersRef.current;
        batchMembersMap.clear();
        const pendingBatchKeys = new Map<string, number[]>();
        result.forEach((plot, i) => {
          const id = newPlotIds[i];
          const existingKey = purchaseBatchRef.current.get(id);
          if (existingKey && existingKey.startsWith("pending|")) {
            const txHash = existingKey.slice(8);
            const owner = plot.owner.toLowerCase();
            if (owner !== ZERO_ADDRESS) {
              const batchKey = `${owner}|${txHash}`;
              purchaseBatchRef.current.set(id, batchKey);
              const arr = pendingBatchKeys.get(batchKey);
              if (arr) arr.push(id);
              else pendingBatchKeys.set(batchKey, [id]);
            }
          }
        });
        for (const [key, ids] of pendingBatchKeys) {
          batchMembersMap.set(key, ids);
        }
        // Real data came from chain — clear optimistic overrides for these IDs
        // (imageUri or owner may have changed).
        {
          const confirmed: number[] = [];
          const opt = useBoardStore.getState().optimisticPlots;
          for (const id of newPlotIds) {
            if (opt[id] !== undefined) confirmed.push(id);
          }
          if (confirmed.length > 0) {
            useBoardStore.getState().removeConfirmedPlots(confirmed);
          }
        }
        // Persist to Turso immediately so the data survives any page refresh
        // without waiting for the GitHub Actions indexer (which runs every 5m).
        const ac = new AbortController();
        for (const [i, plot] of result.entries()) {
          const id = newPlotIds[i];
          fetch("/api/board/upsert", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              plotId: id,
              owner: plot.owner,
              price: plot.price.toString(),
              isForSale: plot.isForSale,
              imageUri: plot.imageUri,
            }),
            signal: ac.signal,
          }).catch((e) => {
            if (e.name !== "AbortError") console.error("Upsert failed for plot", id, e);
          });
        }
        // Persist to localStorage as well for instant re-render fallback.
        const obj: Record<number, Plot> = {};
        map.forEach((v, k) => { obj[k] = v; });
        saveBoardCache(obj);
        if (densityEnabledRef.current) bakeDensity();
        dirtyRef.current = true;
        forceTick((t) => t + 1);
      })();
    },
  });

  // -------------------------------------------------------------------
  // Real-time ImageUpdated event watcher (instant image update)
  // -------------------------------------------------------------------
  useWatchContractEvent({
    address: cfg.isConfigured ? cfg.contract : undefined,
    abi: baseBoardAbi,
    eventName: "ImageUpdated",
    onLogs(logs: { args?: { plotId?: bigint; owner?: `0x${string}`; imageUri?: string } }[]) {
      if (logs.length === 0) return;
      const map = plotMapRef.current;
      let changed = false;
      logs.forEach((log) => {
        const args = log.args;
        if (!args?.plotId || args.imageUri == null) return;
        const id = Number(args.plotId);
        const existing = map.get(id);
        if (existing) {
          map.set(id, { ...existing, imageUri: args.imageUri });
          changed = true;
        }
      });
      if (!changed) return;
      plotBlockDirtyRef.current = true;
      // Persist to Turso immediately (no need to wait for the indexer)
      logs.forEach((log) => {
        const args = log.args;
        if (!args?.plotId || args.imageUri == null) return;
        const id = Number(args.plotId);
        const p = map.get(id);
        if (p) {
          fetch("/api/board/upsert", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              plotId: id,
              owner: p.owner,
              price: p.price.toString(),
              isForSale: p.isForSale,
              imageUri: args.imageUri,
            }),
          }).catch((e) => console.error("Image upsert failed for plot", id, e));
        }
      });
      // Persist to localStorage so image survives refresh
      const obj: Record<number, Plot> = {};
      map.forEach((v, k) => { obj[k] = v; });
      saveBoardCache(obj);
        // Preload the updated images
      const updatedPlots: Record<number, { imageUri: string }> = {};
      logs.forEach((log) => {
        const args = log.args;
        if (!args?.plotId || args.imageUri == null) return;
        updatedPlots[Number(args.plotId)] = { imageUri: args.imageUri };
      });
      preloadImages(updatedPlots);
      dirtyRef.current = true;
    },
  });

  // -------------------------------------------------------------------
  // Turso-only data loading (no RPC reads in the frontend)
  // -------------------------------------------------------------------
  const lastSuccessfulFetchRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stalenessSec, setStalenessSec] = useState(0);

  // Fetch all owned plots from Turso (the primary data source).
  const fetchFromTurso = useCallback(async () => {
    if (!cfg.isConfigured) return;

    // Load from cache instantly so images preload without waiting 15-30s
    const cached = loadBoardCache();
    if (cached && Object.keys(cached).length > 0) {
      const map = plotMapRef.current;
      Object.entries(cached).forEach(([id, plot]) => {
        map.set(Number(id), plot);
      });
      plotBlockDirtyRef.current = true;
      preloadImages(cached);
      dirtyRef.current = true;
    }

    const since = lastSuccessfulFetchRef.current > 0 ? lastSuccessfulFetchRef.current : undefined;
    const res = await fetchTursoBoard(undefined, undefined, since);
    if (!res?.fromCache) return;
    const map = plotMapRef.current;
    Object.entries(res.plots).forEach(([id, plot]) => {
      const existing = map.get(Number(id));
      if (existing && existing.imageUri && existing.imageUri !== plot.imageUri) {
        // Turso has stale data (image not yet upserted) — keep the live data.
        return;
      }
      map.set(Number(id), plot);
    });
    // Merge optimistic overrides into the map so BuyModal data persists
    // even if the watcher fails to fetch fresh data.
    const optimistic = useBoardStore.getState().optimisticPlots;
    for (const [id, plot] of Object.entries(optimistic)) {
      map.set(Number(id), plot);
    }
    plotBlockDirtyRef.current = true;

    // Clear optimistic entries where Turso has real data.
    // Don't check owner/imageUri — if Turso has a row, it is authoritative
    // and the optimistic estimate is no longer needed (resale/image update).
    const confirmed: number[] = [];
    for (const idStr of Object.keys(res.plots)) {
      const id = Number(idStr);
      if (optimistic[id] !== undefined) confirmed.push(id);
    }
    if (confirmed.length > 0) {
      useBoardStore.getState().removeConfirmedPlots(confirmed);
    }

    lastSuccessfulFetchRef.current = Date.now();
    setStalenessSec(0);
    preloadImages(res.plots);
    // Always save the full plotMapRef (Turso + localStorage merged) so
    // newly purchased plots that haven't been indexed by Turso yet survive
    // a page refresh.
    const obj: Record<number, Plot> = {};
    map.forEach((v, k) => { obj[k] = v; });
    saveBoardCache(obj);
    dirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.isConfigured]);

  // Staleness counter: updates every 15s.
  useEffect(() => {
    const id = setInterval(() => {
      setStalenessSec(Math.round((Date.now() - lastSuccessfulFetchRef.current) / 1000));
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  // State isolation: when the chain changes, wipe all cached data.
  const prevChainRef = useRef(chainId);
  useEffect(() => {
    if (prevChainRef.current === chainId) return;
    prevChainRef.current = chainId;
    plotMapRef.current.clear();
    plotBlockDirtyRef.current = true;
    purchaseBlockRef.current.clear();
    purchaseBatchRef.current.clear();
    purchaseBatchMembersRef.current.clear();
    latestBlockRef.current = 0;
    lastSuccessfulFetchRef.current = 0;
    densityCanvasRef.current = null;
    imageCacheRef.current.clear();
    imageRetryRef.current.clear();
    lodCacheRef.current.clear();
    visibleImageUrisRef.current.clear();
    eventAssetsRef.current.clear();
    eventImageRef.current.clear();
    eventMaskRef.current.clear();
    eventMaskDirtyRef.current = true;
    eventLayerRef.current = null;
    clearOptimisticPlots();
    dirtyRef.current = true;
  }, [chainId, clearOptimisticPlots]);

  // Turso fetch on mount.
  useEffect(() => {
    if (!cfg.isConfigured) return;
    let cancelled = false;
    (async () => {
      await fetchFromTurso();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.isConfigured]);

  // Turso re-fetch on tx settlement + 30s polling.
  useEffect(() => {
    void fetchFromTurso();
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => void fetchFromTurso(), 30_000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  // Merge optimistic overrides on top of loaded data for instant post-tx
  // feedback (e.g. a just-bought plot turns "mine" before the re-read lands).
  useEffect(() => {
    const map = plotMapRef.current;
    let changed = false;
    Object.entries(optimisticPlots).forEach(([id, plot]) => {
      map.set(Number(id), plot);
      changed = true;
    });
    if (changed) {
      plotBlockDirtyRef.current = true;
      dirtyRef.current = true;
      forceTick((t) => t + 1);
    }
  }, [optimisticPlots]);

  // -------------------------------------------------------------------
  // Focus / fly-to a plot (from the profile list)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (focusPlotId == null) return;
    const { x, y } = xyFromPlotId(focusPlotId);
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    cam.scale = clamp(20, MIN_SCALE_FLOOR, MAX_SCALE);
    cam.camX = x + 0.5 - width / cam.scale / 2;
    cam.camY = y + 0.5 - height / cam.scale / 2;
    clampCamera();
    setZoomLabel(cam.scale);
    dirtyRef.current = true;
    setFocusPlotId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlotId]);

  // -------------------------------------------------------------------
  // Zoom to fit a bounding box (from "Show on Board" in profile)
  // -------------------------------------------------------------------
  useEffect(() => {
    if (focusBounds == null) return;
    const { x1, y1, x2, y2 } = focusBounds;
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const cellW = x2 - x1 + 1;
    const cellH = y2 - y1 + 1;
    const pad = 0.15;
    const padCells = Math.max(cellW, cellH) * pad;
    const scaleX = (width - 40) / (cellW + padCells * 2);
    const scaleY = (height - 40) / (cellH + padCells * 2);
    cam.scale = clamp(Math.min(scaleX, scaleY), MIN_SCALE_FLOOR, MAX_SCALE);
    const centerX = (x1 + x2) / 2 + 0.5;
    const centerY = (y1 + y2) / 2 + 0.5;
    cam.camX = centerX - width / cam.scale / 2;
    cam.camY = centerY - height / cam.scale / 2;
    clampCamera();
    setZoomLabel(cam.scale);
    dirtyRef.current = true;
    setFocusBounds(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBounds]);

  // -------------------------------------------------------------------
  // Wheel zoom (logarithmic, zoom toward cursor)
  // -------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const worldXBefore = cam.camX + cursorX / cam.scale;
      const worldYBefore = cam.camY + cursorY / cam.scale;

      const factor = Math.pow(1.0015, -e.deltaY);
      const minScale = Math.max(MIN_SCALE_FLOOR, fitScale() * 0.5);
      cam.scale = clamp(cam.scale * factor, minScale, MAX_SCALE);

      cam.camX = worldXBefore - cursorX / cam.scale;
      cam.camY = worldYBefore - cursorY / cam.scale;
      clampCamera();
      setZoomLabel(cam.scale);
      dirtyRef.current = true;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [clampCamera, fitScale]);

  // -------------------------------------------------------------------
  // Pointer interactions (pan / marquee / click-select)
  // -------------------------------------------------------------------
  const getLocal = useCallback((e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }, []);

  /** True when any owned plot sits inside the given box. */
  const hasOwnedPlotsInBox = useCallback(
    (x1: number, y1: number, x2: number, y2: number): boolean => {
      const map = plotMapRef.current;
      for (const id of map.keys()) {
        const { x, y } = xyFromPlotId(id);
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
      }
      return false;
    },
    [],
  );

  /**
   * Event-creation selection completed: validate the region (size cap, fully
   * unowned) and hand it to the drawer's create form. Rejects with a toast
   * instead of accepting, so the user stays in create mode and re-selects.
   */
  const acceptEventDraft = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      if (area > MAX_EVENT_AREA) {
        pushToast(
          "error",
          `Event area is too large — max ${MAX_EVENT_AREA.toLocaleString()} pixels (${x2 - x1 + 1}×${y2 - y1 + 1}).`,
        );
        return;
      }
      if (hasOwnedPlotsInBox(x1, y1, x2, y2)) {
        pushToast(
          "error",
          "This area contains purchased pixels — events need an empty region. Try another area.",
        );
        return;
      }
      setEventDraft({ x1, y1, x2, y2 });
      setEventCreateMode(false);
      setEventDrawerOpen(true);
    },
    [hasOwnedPlotsInBox, pushToast, setEventCreateMode, setEventDraft, setEventDrawerOpen],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Touch input is handled exclusively by the native touch listeners below
      // (multi-touch + tap-suppression). Ignore touch/pen pointer events here
      // so a pinch/pan never double-fires through the mouse code path.
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      const canvas = canvasRef.current!;
      canvas.setPointerCapture(e.pointerId);
      const { sx, sy } = getLocal(e);
      const cell = screenToCell(sx, sy);
      const p = pointerRef.current;
      p.down = true;
      p.dragging = false;
      p.panning = false;
      p.marquee = false;
      p.startSx = sx;
      p.startSy = sy;
      p.lastSx = sx;
      p.lastSy = sy;
      p.startCell = cell;
      p.curCell = cell;
    },
    [getLocal, screenToCell],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const { sx, sy } = getLocal(e);
      const cell = screenToCell(sx, sy);

      // Update hover.
      if (
        cell.x >= 0 &&
        cell.x < GRID_SIZE &&
        cell.y >= 0 &&
        cell.y < GRID_SIZE
      ) {
        hoverCellRef.current = cell;
        setHoverInfo((prev) =>
          prev && prev.x === cell.x && prev.y === cell.y ? prev : cell,
        );
      } else {
        hoverCellRef.current = null;
        setHoverInfo(null);
      }
      dirtyRef.current = true;

      const p = pointerRef.current;
      if (!p.down) return;

      const movedX = sx - p.startSx;
      const movedY = sy - p.startSy;
      if (
        !p.dragging &&
        Math.hypot(movedX, movedY) > DRAG_THRESHOLD
      ) {
        p.dragging = true;
        if (toolRef.current === "select") p.marquee = true;
        else p.panning = true;
      }

      if (p.panning) {
        const cam = cameraRef.current;
        cam.camX -= (sx - p.lastSx) / cam.scale;
        cam.camY -= (sy - p.lastSy) / cam.scale;
        clampCamera();
      } else if (p.marquee) {
        p.curCell = {
          x: clamp(cell.x, 0, GRID_SIZE - 1),
          y: clamp(cell.y, 0, GRID_SIZE - 1),
        };
      }
      p.lastSx = sx;
      p.lastSy = sy;
    },
    [clampCamera, getLocal, screenToCell],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const canvas = canvasRef.current!;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      const p = pointerRef.current;
      if (!p.down) return;
      p.down = false;

      const { sx, sy } = getLocal(e);
      const cell = screenToCell(sx, sy);

      if (!p.dragging) {
        // Pure click -> select single plot.
        if (
          cell.x >= 0 &&
          cell.x < GRID_SIZE &&
          cell.y >= 0 &&
          cell.y < GRID_SIZE
        ) {
          handleSingleSelect(cell.x, cell.y);
        }
      } else if (p.marquee) {
        const x1 = clamp(Math.min(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
        const y1 = clamp(Math.min(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
        const x2 = clamp(Math.max(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
        const y2 = clamp(Math.max(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
        if (eventCreateModeRef.current) {
          acceptEventDraft(x1, y1, x2, y2);
        } else {
          setBuySelection({ x1, y1, x2, y2 });
        }
      }

      p.dragging = false;
      p.panning = false;
      p.marquee = false;
      dirtyRef.current = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getLocal, screenToCell, setBuySelection, acceptEventDraft],
  );

  const handleSingleSelect = useCallback(
    (x: number, y: number) => {
      // Event-creation mode: a click frames a 1×1 event region.
      if (eventCreateModeRef.current) {
        acceptEventDraft(x, y, x, y);
        return;
      }
      const id = plotIdFromXY(x, y);
      const plot = plotMapRef.current.get(id);
      const owned = !!plot && plot.owner.toLowerCase() !== ZERO_ADDRESS;

      // Basket mode: tapping queues/un-queues unowned plots for a bulk buy.
      if (selectModeRef.current) {
        if (owned) {
          openPlot(id); // owned plots can't be basket-bought — inspect instead
        } else {
          toggleBasketPlot(id);
        }
        return;
      }

      if (owned) {
        openPlot(id); // existing plot -> detail modal
      } else {
        setBuySelection({ x1: x, y1: y, x2: x, y2: y }); // empty -> buy
      }
    },
    [acceptEventDraft, openPlot, setBuySelection, toggleBasketPlot],
  );

  // -------------------------------------------------------------------
  // Touch gestures (mobile):
  //   • 1-finger drag  → pan (Pan tool) or marquee box (Select tool)
  //   • 2-finger drag  → pinch-zoom toward the midpoint
  //   • clean 1-finger tap → select / add-to-basket
  // A gesture that ever involved 2 fingers, or that moved past the drag
  // threshold, is flagged so its end NEVER triggers an accidental cell tap.
  // -------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = touchRef.current;
      const p = pointerRef.current;
      const prev = t.active;
      t.active = e.touches.length;
      const rect = canvas.getBoundingClientRect();

      if (prev === 0) {
        // Brand-new gesture: reset all per-gesture flags.
        t.multiTouch = e.touches.length >= 2;
        t.moved = false;
        t.marquee = false;
        p.marquee = false;
      }
      if (e.touches.length >= 2) {
        // A second finger landed — this is a pinch, not a tap/marquee.
        t.multiTouch = true;
        t.marquee = false;
        p.marquee = false;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        t.lastX = touch.clientX - rect.left;
        t.lastY = touch.clientY - rect.top;
        t.startX = t.lastX;
        t.startY = t.lastY;
        const cell = screenToCell(t.lastX, t.lastY);
        p.startCell = cell;
        p.curCell = cell;
      } else if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        t.lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        t.lastMidX = (a.clientX + b.clientX) / 2 - rect.left;
        t.lastMidY = (a.clientY + b.clientY) / 2 - rect.top;
      }
      dirtyRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = touchRef.current;
      const p = pointerRef.current;
      const rect = canvas.getBoundingClientRect();

      if (e.touches.length === 1 && !t.multiTouch) {
        const touch = e.touches[0];
        const sx = touch.clientX - rect.left;
        const sy = touch.clientY - rect.top;
        if (
          !t.moved &&
          Math.hypot(sx - t.startX, sy - t.startY) > DRAG_THRESHOLD
        ) {
          t.moved = true;
          // In Select tool a single-finger drag draws a marquee box.
          if (toolRef.current === "select") {
            t.marquee = true;
            p.marquee = true;
            p.startCell = screenToCell(t.startX, t.startY);
          }
        }
        if (t.moved) {
          if (t.marquee) {
            const cell = screenToCell(sx, sy);
            p.curCell = {
              x: clamp(cell.x, 0, GRID_SIZE - 1),
              y: clamp(cell.y, 0, GRID_SIZE - 1),
            };
            dirtyRef.current = true;
          } else {
            const cam = cameraRef.current;
            cam.camX -= (sx - t.lastX) / cam.scale;
            cam.camY -= (sy - t.lastY) / cam.scale;
            clampCamera();
            dirtyRef.current = true;
          }
        }
        t.lastX = sx;
        t.lastY = sy;
      } else if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const midX = (a.clientX + b.clientX) / 2 - rect.left;
        const midY = (a.clientY + b.clientY) / 2 - rect.top;
        if (t.lastDist > 0) {
          const cam = cameraRef.current;
          const factor = dist / t.lastDist;
          const worldXBefore = cam.camX + midX / cam.scale;
          const worldYBefore = cam.camY + midY / cam.scale;
          const minScale = Math.max(MIN_SCALE_FLOOR, fitScale() * 0.5);
          cam.scale = clamp(cam.scale * factor, minScale, MAX_SCALE);
          cam.camX = worldXBefore - midX / cam.scale;
          cam.camY = worldYBefore - midY / cam.scale;
          clampCamera();
          cam.camX -= (midX - t.lastMidX) / cam.scale;
          cam.camY -= (midY - t.lastMidY) / cam.scale;
          clampCamera();
          setZoomLabel(cam.scale);
          dirtyRef.current = true;
        }
        t.lastDist = dist;
        t.lastMidX = midX;
        t.lastMidY = midY;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const t = touchRef.current;
      const p = pointerRef.current;

      // Only resolve the gesture once every finger has lifted.
      if (e.touches.length === 0) {
        if (t.marquee && !t.multiTouch) {
          const x1 = clamp(Math.min(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
          const y1 = clamp(Math.min(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
          const x2 = clamp(Math.max(p.startCell.x, p.curCell.x), 0, GRID_SIZE - 1);
          const y2 = clamp(Math.max(p.startCell.y, p.curCell.y), 0, GRID_SIZE - 1);
          if (eventCreateModeRef.current) {
            acceptEventDraft(x1, y1, x2, y2);
          } else {
            setBuySelection({ x1, y1, x2, y2 });
          }
        } else if (!t.multiTouch && !t.moved) {
          // Clean, intentional single-finger tap.
          const cell = screenToCell(t.lastX, t.lastY);
          if (
            cell.x >= 0 &&
            cell.x < GRID_SIZE &&
            cell.y >= 0 &&
            cell.y < GRID_SIZE
          ) {
            handleSingleSelect(cell.x, cell.y);
          }
        }
        // Reset all per-gesture state for the next interaction.
        t.lastDist = 0;
        t.multiTouch = false;
        t.moved = false;
        t.marquee = false;
        p.marquee = false;
        dirtyRef.current = true;
      }
      t.active = e.touches.length;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [
    clampCamera,
    fitScale,
    handleSingleSelect,
    screenToCell,
    setBuySelection,
    acceptEventDraft,
  ]);

  // -------------------------------------------------------------------
  // Zoom buttons / recenter
  // -------------------------------------------------------------------
  const zoomBy = useCallback(
    (factor: number) => {
      const cam = cameraRef.current;
      const { width, height } = sizeRef.current;
      const cx = width / 2;
      const cy = height / 2;
      const wx = cam.camX + cx / cam.scale;
      const wy = cam.camY + cy / cam.scale;
      const minScale = Math.max(MIN_SCALE_FLOOR, fitScale() * 0.5);
      cam.scale = clamp(cam.scale * factor, minScale, MAX_SCALE);
      cam.camX = wx - cx / cam.scale;
      cam.camY = wy - cy / cam.scale;
      clampCamera();
      setZoomLabel(cam.scale);
      dirtyRef.current = true;
    },
    [clampCamera, fitScale],
  );

  const recenter = useCallback(() => {
    fitWholeBoard();
    clampCamera();
    dirtyRef.current = true;
  }, [clampCamera, fitWholeBoard]);

  const cursorClass = useMemo(() => {
    if (tool === "select") return "cursor-crosshair";
    return "cursor-grab active:cursor-grabbing";
  }, [tool]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`baseboard-canvas absolute inset-0 touch-none ${cursorClass}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoverCellRef.current = null;
          setHoverInfo(null);
          dirtyRef.current = true;
        }}
      />

      {/* Tool + zoom controls */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <div className="flex overflow-hidden rounded-xl border-2 border-base-blue bg-white shadow">
          <button
            type="button"
            onClick={() => setTool("pan")}
            className={`px-3 py-1.5 text-sm font-semibold ${
              tool === "pan" ? "bg-base-blue text-white" : "text-base-blue"
            }`}
          >
            ✋ Pan
          </button>
          <button
            type="button"
            onClick={() => setTool("select")}
            className={`border-l-2 border-base-blue px-3 py-1.5 text-sm font-semibold ${
              tool === "select" ? "bg-base-blue text-white" : "text-base-blue"
            }`}
          >
            ▭ Select
          </button>
          <button
            type="button"
            onClick={toggleSelectMode}
            title="Tap pixels one-by-one to add them to a buy basket"
            className={`border-l-2 border-base-blue px-3 py-1.5 text-sm font-semibold ${
              selectMode ? "bg-base-blue text-white" : "text-base-blue"
            }`}
          >
            ＋ Multi
          </button>
        </div>
        <div className="flex w-fit overflow-hidden rounded-xl border-2 border-base-blue bg-white shadow">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4)}
            className="px-3 py-1.5 text-base font-bold text-base-blue"
            aria-label="zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.4)}
            className="border-l-2 border-base-blue px-3 py-1.5 text-base font-bold text-base-blue"
            aria-label="zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={recenter}
            className="border-l-2 border-base-blue px-3 py-1.5 text-xs font-semibold text-base-blue"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Coordinate / zoom / staleness readout (hidden on mobile so the
          centered density controls own the bottom of the board there) */}
      <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-lg bg-base-blue/90 px-3 py-1.5 text-xs font-semibold text-white shadow sm:block">
        {hoverInfo ? `X: ${hoverInfo.x} · Y: ${hoverInfo.y}` : "Hover the board"}
        <span className="ml-2 opacity-80">· {zoomLabel.toFixed(1)} px/cell</span>
        {stalenessSec > 10 && (
          <span className="ml-2 opacity-60">
            · {stalenessSec < 60 ? `<1m` : `${Math.floor(stalenessSec / 60)}m`}
          </span>
        )}
      </div>

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 hidden rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-base-blue shadow sm:block">
        Scroll = zoom · Drag = {tool === "pan" ? "pan" : "select"} · Click = inspect/buy
      </div>

      {/* Basket action bar (tap-to-add multi-select) */}
      {(selectMode || basket.length > 0) && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border-2 border-base-blue bg-white px-3 py-2 shadow-lg">
          <span className="whitespace-nowrap text-sm font-bold text-base-blue">
            🧺 {basket.length} selected
          </span>
          <button
            type="button"
            disabled={basket.length === 0}
            onClick={() => setDirectBuyIds(basket)}
            className="rounded-lg bg-base-blue px-3 py-1.5 text-sm font-bold text-white hover:bg-base-dark disabled:opacity-50"
          >
            Buy Selected
          </button>
          <button
            type="button"
            disabled={basket.length === 0}
            onClick={clearBasket}
            className="rounded-lg border-2 border-base-blue px-2.5 py-1.5 text-sm font-semibold text-base-blue disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      )}
      {/* Event-creation hint bar (active while framing the region) */}
      {eventCreateMode && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border-2 border-base-blue bg-white px-3 py-2 shadow-lg">
          <span className="whitespace-nowrap text-sm font-bold text-base-blue">
            ✏️ Draw your event area with the Select tool
          </span>
          <button
            type="button"
            onClick={() => setEventCreateMode(false)}
            className="rounded-lg border-2 border-base-blue px-2.5 py-1.5 text-sm font-semibold text-base-blue hover:bg-blue-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Resolve ipfs:// URIs (and bare CIDs) to an HTTP gateway. */
function resolveUri(uri: string, gatewayIdx = 0): string {
  if (!uri) return uri;
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice("ipfs://".length);
    return IPFS_GATEWAYS[Math.min(gatewayIdx, IPFS_GATEWAYS.length - 1)](cid);
  }
  if (/^[a-zA-Z0-9]{46,}$/.test(uri) && !uri.startsWith("http")) {
    return IPFS_GATEWAYS[Math.min(gatewayIdx, IPFS_GATEWAYS.length - 1)](uri);
  }
  return uri;
}
