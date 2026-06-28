"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePublicClient, useAccount, useChainId } from "wagmi";
import { baseBoardAbi, readContractWithTimeout } from "@/lib/contract";
import { GRID_SIZE, ZERO_ADDRESS } from "@/lib/constants";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { clamp, plotIdFromXY, xyFromPlotId } from "@/lib/coords";
import { parseZone, stripZone } from "@/lib/image";
import {
  DENSITY_ALPHA_CAP,
  DENSITY_BUCKETS,
  DENSITY_RECENT_MIN,
  DENSITY_RECENT_WINDOW_BLOCKS,
  DENSITY_RGB,
} from "@/lib/density";
import type { Plot } from "@/lib/types";
import { useBoardStore } from "@/store/useBoardStore";

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
const MAX_QUERY_CELLS = 1600; // cap on per-viewport contract reads
const LOD_THUMB_DIM = 128; // longest side of the cached LOD thumbnail
// Above this many on-screen image groups we always blit the cheap LOD
// thumbnail instead of the full-resolution source, even when zoomed in.
const LOD_FULL_MAX_GROUPS = 120;
// When a whole billboard shrinks to roughly this few pixels on screen, paint a
// flat dominant-colour swatch instead of scaling an image down to a dot.
const LOD_SWATCH_PX = 4;
const DRAG_THRESHOLD = 4; // px movement before a press counts as a drag

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

  const openPlot = useBoardStore((s) => s.openPlot);
  const setBuySelection = useBoardStore((s) => s.setBuySelection);
  const refreshNonce = useBoardStore((s) => s.refreshNonce);
  const focusPlotId = useBoardStore((s) => s.focusPlotId);
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const selectMode = useBoardStore((s) => s.selectMode);
  const toggleSelectMode = useBoardStore((s) => s.toggleSelectMode);
  const basket = useBoardStore((s) => s.basket);
  const toggleBasketPlot = useBoardStore((s) => s.toggleBasketPlot);
  const clearBasket = useBoardStore((s) => s.clearBasket);
  const setDirectBuyIds = useBoardStore((s) => s.setDirectBuyIds);
  const optimisticPlots = useBoardStore((s) => s.optimisticPlots);
  const clearOptimisticPlots = useBoardStore((s) => s.clearOptimisticPlots);

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
  const basketSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    basketSetRef.current = new Set(basket);
    dirtyRef.current = true;
  }, [basket]);

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
  const imageCacheRef = useRef<Map<string, HTMLImageElement | "error">>(
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
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

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

  const renderBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, dpr } = sizeRef.current;
    const cam = cameraRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Board background (pure white surface inside the frame).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

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
    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(boardLeft, boardTop, boardSize, boardSize);

    // ---- Owned plots + stretched images (grouped by owner+uri) ----
    // Clip to the board's content rect so nothing — including the enforced
    // minimum marker size at full zoom-out — can ever draw past the grid
    // boundary and bleed outside the framed canvas.
    ctx.save();
    ctx.beginPath();
    ctx.rect(boardLeft, boardTop, boardSize, boardSize);
    ctx.clip();
    drawPlots(ctx, cam, startX, startY, endX, endY, cellToScreenX, cellToScreenY);
    ctx.restore();

    // ---- Purchase-density overlay (Part 10.2) ----
    // Additive translucent blue layer on top of the pixel fills, strictly
    // clipped to the board rect so it can never bleed outside the frame. The
    // coarse baked field is stretched across the board with bilinear smoothing
    // for a soft gradient; its capped alpha keeps the underlying pixels visible.
    const densityField = densityCanvasRef.current;
    if (densityField && densityField.width > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(boardLeft, boardTop, boardSize, boardSize);
      ctx.clip();
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(densityField, boardLeft, boardTop, boardSize, boardSize);
      ctx.imageSmoothingEnabled = prevSmoothing;
      ctx.restore();
    }

    // ---- Solid Base-blue outline marking the active grid boundary ----
    // Always visible so the playable map is clearly separated from the white
    // inner container, even when zoomed all the way out.
    ctx.save();
    ctx.strokeStyle = "#0052ff";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      boardLeft + 1.5,
      boardTop + 1.5,
      boardSize - 3,
      boardSize - 3,
    );
    ctx.restore();

    // ---- Grid lines (fade in as we zoom in) ----
    const gridAlpha =
      cam.scale <= GRID_FADE_START
        ? 0
        : cam.scale >= GRID_FADE_FULL
          ? 1
          : (cam.scale - GRID_FADE_START) / (GRID_FADE_FULL - GRID_FADE_START);

    if (gridAlpha > 0.02) {
      ctx.save();
      ctx.strokeStyle = `rgba(59,130,246,${0.35 * gridAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX + 1; x++) {
        const sx = Math.round(cellToScreenX(x)) + 0.5;
        ctx.moveTo(sx, Math.max(0, boardTop));
        ctx.lineTo(sx, Math.min(height, boardTop + boardSize));
      }
      for (let y = startY; y <= endY + 1; y++) {
        const sy = Math.round(cellToScreenY(y)) + 0.5;
        ctx.moveTo(Math.max(0, boardLeft), sy);
        ctx.lineTo(Math.min(width, boardLeft + boardSize), sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- Hover highlight ----
    const hov = hoverCellRef.current;
    if (hov && cam.scale > 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,82,255,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        cellToScreenX(hov.x),
        cellToScreenY(hov.y),
        cam.scale,
        cam.scale,
      );
      ctx.restore();
    }

    // ---- Marquee selection rectangle ----
    const p = pointerRef.current;
    if (p.marquee) {
      const x1 = Math.min(p.startCell.x, p.curCell.x);
      const y1 = Math.min(p.startCell.y, p.curCell.y);
      const x2 = Math.max(p.startCell.x, p.curCell.x);
      const y2 = Math.max(p.startCell.y, p.curCell.y);
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
    }

    // ---- Basket (tap-to-add multi-select) highlights ----
    const basketIds = basketSetRef.current;
    if (basketIds.size > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0,82,255,0.30)";
      ctx.strokeStyle = "#0052ff";
      ctx.lineWidth = Math.max(1, Math.min(3, cam.scale * 0.15));
      basketIds.forEach((id) => {
        const { x, y } = xyFromPlotId(id);
        if (x < startX - 1 || x > endX + 1 || y < startY - 1 || y > endY + 1)
          return;
        const sx = cellToScreenX(x);
        const sy = cellToScreenY(y);
        ctx.fillRect(sx, sy, cam.scale, cam.scale);
        if (cam.scale > 3) ctx.strokeRect(sx, sy, cam.scale, cam.scale);
      });
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
        if (visible) {
          const isMine = me && plot.owner.toLowerCase() === me;
          const sx = cellToScreenX(x);
          const sy = cellToScreenY(y);
          const zoomedOut = cam.scale < IMAGE_MIN_SCALE;
          // Enforce a minimum on-screen marker so a single plot never collapses
          // to a sub-pixel dot when fully zoomed out, and use a stronger palette
          // at low zoom so claimed/for-sale plots read clearly.
          const marker = Math.max(cam.scale, zoomedOut ? 3.5 : 3);
          ctx.fillStyle = plot.isForSale
            ? zoomedOut
              ? "#0052ff"
              : "#60a5fa"
            : isMine
              ? "#1d4ed8"
              : zoomedOut
                ? "#93c5fd"
                : "#bfdbfe";
          ctx.fillRect(sx, sy, marker, marker);
        }

        // Build image groups for EVERY loaded image plot regardless of whether
        // its own anchor cell is currently on-screen. A multi-plot billboard's
        // anchor (which carries the zone fragment) is often just off the visible
        // edge while most of the artwork is still in view — culling here is what
        // made perimeter images vanish during pan/zoom. We cull whole groups at
        // draw time by their span bbox instead.
        if (plot.imageUri) {
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
        groups.forEach((g) => {
          const img = getImage(g.uri);
          if (!img || img === "error" || !img.complete || img.naturalWidth === 0)
            return;

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

          const dx = cellToScreenX(bx1);
          const dy = cellToScreenY(by1);
          const w = (bx2 - bx1 + 1) * cam.scale;
          const h = (by2 - by1 + 1) * cam.scale;

          ctx.save();
          ctx.beginPath();
          if (!preciseClip) {
            // Zoomed out: cells are sub-pixel, so a precise per-cell clip is
            // wasted work — draw the artwork across the whole span bbox cheaply.
            ctx.rect(dx, dy, w, h);
          } else if (g.zone) {
            // Clip to the owner's loaded cells inside the zone so the image
            // never bleeds onto plots they don't own.
            let clipped = 0;
            map.forEach((p, id2) => {
              if (p.owner.toLowerCase() !== g.owner) return;
              const c = xyFromPlotId(id2);
              if (c.x < bx1 || c.x > bx2 || c.y < by1 || c.y > by2) return;
              ctx.rect(
                cellToScreenX(c.x),
                cellToScreenY(c.y),
                cam.scale,
                cam.scale,
              );
              clipped++;
            });
            if (clipped === 0) {
              // The zone's cells haven't loaded yet. Drawing against the full
              // unclipped bbox here would briefly bleed the image onto plots the
              // owner may not actually hold (the wrong-render flash on fresh
              // loads). Skip this group this frame and retry next frame once the
              // cells arrive — the base owned-fill underneath keeps it non-blank.
              ctx.restore();
              dirtyRef.current = true;
              return;
            }
          } else {
            g.cells.forEach((c) => {
              ctx.rect(
                cellToScreenX(c.x),
                cellToScreenY(c.y),
                cam.scale,
                cam.scale,
              );
            });
          }
          ctx.clip();
          try {
            const lod = getLod(g.uri, img);
            if (lod && w <= LOD_SWATCH_PX && h <= LOD_SWATCH_PX) {
              // Billboard is only a few pixels on screen — a flat dominant
              // colour swatch is indistinguishable from a scaled image but far
              // cheaper. (Still non-blank at the most zoomed-out levels.)
              ctx.fillStyle = lod.dominant;
              ctx.fillRect(dx, dy, w, h);
            } else {
              // Stretch (object-fit: fill) the source across the span, scaling
              // X and Y independently to exactly fill the zone — no letterbox,
              // no crop. Use the full image only when zoomed in with few groups;
              // otherwise blit the cached low-res thumbnail for performance.
              const useFull = preciseClip && !manyGroups;
              const src = useFull || !lod ? img : lod.thumb;
              ctx.drawImage(src, dx, dy, w, h);
            }
          } catch {
            /* tainted/broken image — fill already drawn underneath */
          }
          ctx.restore();
        });
      }

      // "For sale" markers when zoomed in.
      if (cam.scale >= IMAGE_MIN_SCALE) {
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.max(8, cam.scale * 0.5)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        map.forEach((plot, id) => {
          if (!plot.isForSale) return;
          const { x, y } = xyFromPlotId(id);
          if (x < startX - 1 || x > endX + 1 || y < startY - 1 || y > endY + 1)
            return;
          if (plot.imageUri) return;
          ctx.fillText(
            "$",
            cellToScreenX(x) + cam.scale / 2,
            cellToScreenY(y) + cam.scale / 2,
          );
        });
        ctx.restore();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address],
  );

  const getImage = useCallback(
    (uri: string): HTMLImageElement | "error" | null => {
      const cache = imageCacheRef.current;
      const existing = cache.get(uri);
      if (existing) return existing;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        dirtyRef.current = true;
      };
      img.onerror = () => {
        cache.set(uri, "error");
      };
      img.src = resolveUri(stripZone(uri));
      cache.set(uri, img);
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
      return entry;
    },
    [],
  );

  // -------------------------------------------------------------------
  // Data loading for the visible viewport (debounced on camera settle)
  // -------------------------------------------------------------------
  const loadViewport = useCallback(async () => {
    if (!cfg.isConfigured || !publicClient) return;
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    const startX = Math.max(0, Math.floor(cam.camX));
    const startY = Math.max(0, Math.floor(cam.camY));
    const endX = Math.min(GRID_SIZE - 1, Math.ceil(cam.camX + width / cam.scale));
    const endY = Math.min(GRID_SIZE - 1, Math.ceil(cam.camY + height / cam.scale));

    const cols = endX - startX + 1;
    const rows = endY - startY + 1;
    if (cols * rows > MAX_QUERY_CELLS) return; // too zoomed out to enumerate

    const ids: bigint[] = [];
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        ids.push(BigInt(plotIdFromXY(x, y)));
      }
    }
    if (ids.length === 0) return;

    try {
      const result = (await readContractWithTimeout(
        publicClient.readContract({
          address: cfg.contract,
          abi: baseBoardAbi,
          functionName: "getPlotsBatch",
          args: [ids],
        }),
      )) as readonly Plot[];

      const map = plotMapRef.current;
      result.forEach((plot, i) => {
        const id = Number(ids[i]);
        if (plot.owner.toLowerCase() !== ZERO_ADDRESS) {
          map.set(id, plot);
        } else {
          map.delete(id);
        }
      });
      dirtyRef.current = true;
      forceTick((t) => t + 1);
    } catch {
      /* read failed (rpc / not deployed) — keep prior data */
    }
  }, [publicClient, cfg.isConfigured, cfg.contract]);

  // Debounce viewport loads.
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => void loadViewport(), 220);
  }, [loadViewport]);

  // -------------------------------------------------------------------
  // Global load: enumerate *every* minted plot so owned / for-sale plots are
  // visible at any zoom level (the viewport scan above only covers a small,
  // zoomed-in window). We discover minted plot ids from `PlotsPurchased` logs
  // (scanned incrementally from the deploy block) then batch-read their current
  // on-chain state so listings / transfers stay accurate.
  // -------------------------------------------------------------------
  const allMintedIdsRef = useRef<Set<number>>(new Set());
  const lastScanBlockRef = useRef<number>(0);
  const globalLoadingRef = useRef(false);

  // ---- Purchase-density overlay state (Part 10.2) ----
  // Block at which each plot was last seen purchased (drives the recency
  // window), the latest scanned block, and a low-res baked density field that
  // renderBoard stretches over the board as a soft additive blue tint.
  const purchaseBlockRef = useRef<Map<number, number>>(new Map());
  const latestBlockRef = useRef<number>(0);
  const densityCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  const loadAllMinted = useCallback(async () => {
    if (!cfg.isConfigured || !publicClient) return;
    if (globalLoadingRef.current) return;
    globalLoadingRef.current = true;
    try {
      const latest = Number(await publicClient.getBlockNumber());
      const from =
        lastScanBlockRef.current > 0
          ? lastScanBlockRef.current + 1
          : cfg.deployBlock;

      // 1) Discover newly-minted plot ids from PlotsPurchased logs (chunked to
      //    respect RPC block-range limits). Base's public RPC caps eth_getLogs
      //    at a 10,000-block range, so a larger window makes EVERY request fail
      //    and no plots ever load when zoomed out — keep this safely under 10k.
      const LOG_CHUNK = 9_500;
      for (let start = from; start <= latest; start += LOG_CHUNK + 1) {
        const end = Math.min(start + LOG_CHUNK, latest);
        try {
          const logs = await publicClient.getContractEvents({
            address: cfg.contract,
            abi: baseBoardAbi,
            eventName: "PlotsPurchased",
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
          });
          logs.forEach((log) => {
            const blk = Number(log.blockNumber ?? 0n);
            const args = log.args as { plotIds?: readonly bigint[] };
            args.plotIds?.forEach((b) => {
              const id = Number(b);
              allMintedIdsRef.current.add(id);
              purchaseBlockRef.current.set(id, blk);
            });
          });
        } catch {
          /* range rejected by RPC — skip this window, keep going */
        }
      }
      lastScanBlockRef.current = latest;
      latestBlockRef.current = latest;

      // 2) Refresh current state for every known plot id (chunked reads).
      const all = Array.from(allMintedIdsRef.current);
      const map = plotMapRef.current;
      const READ_CHUNK = 400;
      for (let i = 0; i < all.length; i += READ_CHUNK) {
        const slice = all.slice(i, i + READ_CHUNK);
        try {
          const res = (await readContractWithTimeout(
            publicClient.readContract({
              address: cfg.contract,
              abi: baseBoardAbi,
              functionName: "getPlotsBatch",
              args: [slice.map((n) => BigInt(n))],
            }),
          )) as readonly Plot[];
          res.forEach((plot, j) => {
            const id = slice[j];
            if (plot.owner.toLowerCase() !== ZERO_ADDRESS) map.set(id, plot);
            else map.delete(id);
          });
          // Paint progressively so plots appear as each chunk lands instead of
          // only after the entire (possibly large) scan finishes.
          dirtyRef.current = true;
          forceTick((t) => t + 1);
        } catch {
          /* keep prior data for this chunk */
        }
      }
      bakeDensity();
      dirtyRef.current = true;
      forceTick((t) => t + 1);
    } catch {
      /* rpc unavailable — keep whatever we have */
    } finally {
      globalLoadingRef.current = false;
    }
  }, [publicClient, cfg.isConfigured, cfg.contract, cfg.deployBlock, bakeDensity]);

  // State isolation: when the active chain changes, wipe every
  // cached plot, the minted-id set, the log-scan cursor, decoded images and any
  // optimistic overrides so we never show one network's board on another. The
  // load effects below re-run automatically (their callbacks are rebuilt from
  // the new chain's contract) and repopulate from the active network.
  const prevChainRef = useRef(chainId);
  useEffect(() => {
    if (prevChainRef.current === chainId) return;
    prevChainRef.current = chainId;
    plotMapRef.current.clear();
    allMintedIdsRef.current.clear();
    lastScanBlockRef.current = 0;
    purchaseBlockRef.current.clear();
    latestBlockRef.current = 0;
    densityCanvasRef.current = null;
    imageCacheRef.current.clear();
    lodCacheRef.current.clear();
    clearOptimisticPlots();
    dirtyRef.current = true;
    forceTick((t) => t + 1);
  }, [chainId, clearOptimisticPlots]);

  // Initial global load + light polling so other users' buys/listings appear
  // without a manual refresh, at every zoom level.
  useEffect(() => {
    void loadAllMinted();
    const t = setInterval(() => void loadAllMinted(), 30_000);
    return () => clearInterval(t);
  }, [loadAllMinted]);

  // Re-scan after our own tx settles so changes reflect immediately.
  useEffect(() => {
    void loadAllMinted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  // Reload when data is invalidated by a settled tx. We re-read the visible
  // viewport immediately (no debounce, no full clear) so ownership/status
  // changes show up right after the receipt confirms instead of on the next
  // poll. loadViewport self-corrects each cell (set if owned, delete if free).
  useEffect(() => {
    void loadViewport();
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
    scheduleLoad();
    setFocusPlotId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlotId]);

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
      scheduleLoad();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [clampCamera, fitScale, scheduleLoad]);

  // -------------------------------------------------------------------
  // Pointer interactions (pan / marquee / click-select)
  // -------------------------------------------------------------------
  const getLocal = useCallback((e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }, []);

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
        scheduleLoad();
      } else if (p.marquee) {
        p.curCell = {
          x: clamp(cell.x, 0, GRID_SIZE - 1),
          y: clamp(cell.y, 0, GRID_SIZE - 1),
        };
      }
      p.lastSx = sx;
      p.lastSy = sy;
    },
    [clampCamera, getLocal, screenToCell, scheduleLoad],
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
        setBuySelection({ x1, y1, x2, y2 });
      }

      p.dragging = false;
      p.panning = false;
      p.marquee = false;
      dirtyRef.current = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getLocal, screenToCell, setBuySelection],
  );

  const handleSingleSelect = useCallback(
    (x: number, y: number) => {
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
    [openPlot, setBuySelection, toggleBasketPlot],
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
            scheduleLoad();
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
          scheduleLoad();
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
          setBuySelection({ x1, y1, x2, y2 });
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
    scheduleLoad,
    screenToCell,
    setBuySelection,
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
      scheduleLoad();
    },
    [clampCamera, fitScale, scheduleLoad],
  );

  const recenter = useCallback(() => {
    fitWholeBoard();
    clampCamera();
    dirtyRef.current = true;
    scheduleLoad();
  }, [clampCamera, fitWholeBoard, scheduleLoad]);

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

      {/* Coordinate / zoom readout */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-base-blue/90 px-3 py-1.5 text-xs font-semibold text-white shadow">
        {hoverInfo ? `X: ${hoverInfo.x} · Y: ${hoverInfo.y}` : "Hover the board"}
        <span className="ml-2 opacity-80">· {zoomLabel.toFixed(1)} px/cell</span>
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
    </div>
  );
}

/** Resolve ipfs:// URIs (and bare CIDs) to an HTTP gateway. */
function resolveUri(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  if (/^[a-zA-Z0-9]{46,}$/.test(uri) && !uri.startsWith("http")) {
    return `https://ipfs.io/ipfs/${uri}`;
  }
  return uri;
}
