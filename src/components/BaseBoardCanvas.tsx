"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePublicClient, useAccount } from "wagmi";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import {
  GRID_SIZE,
  IS_CONTRACT_CONFIGURED,
  ZERO_ADDRESS,
} from "@/lib/constants";
import { clamp, plotIdFromXY, xyFromPlotId } from "@/lib/coords";
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

  const openPlot = useBoardStore((s) => s.openPlot);
  const setBuySelection = useBoardStore((s) => s.setBuySelection);
  const refreshNonce = useBoardStore((s) => s.refreshNonce);
  const focusPlotId = useBoardStore((s) => s.focusPlotId);
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);

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

  // Loaded plot data for the current viewport + image cache.
  const plotMapRef = useRef<Map<number, Plot>>(new Map());
  const imageCacheRef = useRef<Map<string, HTMLImageElement | "error">>(
    new Map(),
  );
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

      // Initialize camera centered on first valid size.
      const cam = cameraRef.current;
      if (cam.scale === 1 && cam.camX === 0 && cam.camY === 0) {
        const minScale = fitScale();
        cam.scale = clamp(minScale * 6, MIN_SCALE_FLOOR, MAX_SCALE);
        cam.camX = GRID_SIZE / 2 - rect.width / cam.scale / 2;
        cam.camY = GRID_SIZE / 2 - rect.height / cam.scale / 2;
        setZoomLabel(cam.scale);
      }
      dirtyRef.current = true;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitScale]);

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
    drawPlots(ctx, cam, startX, startY, endX, endY, cellToScreenX, cellToScreenY);

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
      const drawImages = cam.scale >= IMAGE_MIN_SCALE;

      // Bucket loaded plots by `${owner}|${imageUri}` to compute zone bboxes.
      type Group = {
        owner: string;
        uri: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        ids: number[];
      };
      const groups = new Map<string, Group>();

      map.forEach((plot, id) => {
        if (plot.owner.toLowerCase() === ZERO_ADDRESS) return;
        const { x, y } = xyFromPlotId(id);
        if (x < startX - 1 || x > endX + 1 || y < startY - 1 || y > endY + 1)
          return;

        // Base fill per cell.
        const isMine = me && plot.owner.toLowerCase() === me;
        const sx = cellToScreenX(x);
        const sy = cellToScreenY(y);
        ctx.fillStyle = plot.isForSale
          ? "#60a5fa"
          : isMine
            ? "#1d4ed8"
            : "#bfdbfe";
        ctx.fillRect(sx, sy, cam.scale, cam.scale);

        if (plot.imageUri) {
          const key = `${plot.owner.toLowerCase()}|${plot.imageUri}`;
          const g = groups.get(key);
          if (g) {
            g.x1 = Math.min(g.x1, x);
            g.y1 = Math.min(g.y1, y);
            g.x2 = Math.max(g.x2, x);
            g.y2 = Math.max(g.y2, y);
            g.ids.push(id);
          } else {
            groups.set(key, {
              owner: plot.owner,
              uri: plot.imageUri,
              x1: x,
              y1: y,
              x2: x,
              y2: y,
              ids: [id],
            });
          }
        }
      });

      // Stretch one image across each group's bounding box.
      if (drawImages) {
        groups.forEach((g) => {
          const img = getImage(g.uri);
          if (img && img !== "error" && img.complete && img.naturalWidth > 0) {
            const sx = cellToScreenX(g.x1);
            const sy = cellToScreenY(g.y1);
            const w = (g.x2 - g.x1 + 1) * cam.scale;
            const h = (g.y2 - g.y1 + 1) * cam.scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(sx, sy, w, h);
            ctx.clip();
            try {
              ctx.drawImage(img, sx, sy, w, h);
            } catch {
              /* tainted/broken image — fill already drawn underneath */
            }
            ctx.restore();
          }
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
      img.src = resolveUri(uri);
      cache.set(uri, img);
      return img;
    },
    [],
  );

  // -------------------------------------------------------------------
  // Data loading for the visible viewport (debounced on camera settle)
  // -------------------------------------------------------------------
  const loadViewport = useCallback(async () => {
    if (!IS_CONTRACT_CONFIGURED || !publicClient) return;
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
      const result = (await publicClient.readContract({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "getPlotsBatch",
        args: [ids],
      })) as readonly Plot[];

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
  }, [publicClient]);

  // Debounce viewport loads.
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => void loadViewport(), 220);
  }, [loadViewport]);

  // Reload when data is invalidated by a settled tx.
  useEffect(() => {
    plotMapRef.current.clear();
    scheduleLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

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
      if (plot && plot.owner.toLowerCase() !== ZERO_ADDRESS) {
        openPlot(id); // existing plot -> detail modal
      } else {
        setBuySelection({ x1: x, y1: y, x2: x, y2: y }); // empty -> buy
      }
    },
    [openPlot, setBuySelection],
  );

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
    const cam = cameraRef.current;
    const { width, height } = sizeRef.current;
    cam.scale = clamp(fitScale() * 6, MIN_SCALE_FLOOR, MAX_SCALE);
    cam.camX = GRID_SIZE / 2 - width / cam.scale / 2;
    cam.camY = GRID_SIZE / 2 - height / cam.scale / 2;
    clampCamera();
    setZoomLabel(cam.scale);
    dirtyRef.current = true;
    scheduleLoad();
  }, [clampCamera, fitScale, scheduleLoad]);

  const cursorClass = useMemo(() => {
    if (tool === "select") return "cursor-crosshair";
    return "cursor-grab active:cursor-grabbing";
  }, [tool]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`baseboard-canvas absolute inset-0 ${cursorClass}`}
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
            className={`px-3 py-1.5 text-sm font-semibold ${
              tool === "select" ? "bg-base-blue text-white" : "text-base-blue"
            }`}
          >
            ▭ Select
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
