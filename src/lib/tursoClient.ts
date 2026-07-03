import type { Plot } from "./types";

/** Wire format returned by /api/board — price is a decimal string (JSON-safe). */
interface PlotWire {
  owner: string;
  price: string;
  isForSale: boolean;
  imageUri: string;
}

export interface TursoBoardResponse {
  plots: Record<number, Plot>;
  fromCache: boolean;
}

export interface TursoLeaderboardEntry {
  owner: `0x${string}`;
  count: number;
  tieBreakBlock: number;
  rank: number;
}

export interface TursoPurchaseEvent {
  buyer: `0x${string}`;
  count: number;
  block: number;
  txHash: string;
}

export interface TursoLeaderboardResponse {
  ranking: TursoLeaderboardEntry[];
  events: TursoPurchaseEvent[];
  fromCache: boolean;
}

export interface TursoStatsResponse {
  sold: number | null;
  available: boolean;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Wire response from /api/board before bigint conversion. */
interface BoardWireResponse {
  plots: Record<number, PlotWire>;
  fromCache: boolean;
}

function convertBoardWire(wire: BoardWireResponse): TursoBoardResponse {
  const plots: Record<number, Plot> = {};
  for (const [id, p] of Object.entries(wire.plots)) {
    plots[Number(id)] = {
      owner: p.owner as `0x${string}`,
      price: BigInt(p.price),
      isForSale: p.isForSale,
      imageUri: p.imageUri,
    };
  }
  return { plots, fromCache: wire.fromCache };
}

export async function fetchTursoBoard(
  ids?: number[],
  signal?: AbortSignal,
): Promise<TursoBoardResponse | null> {
  const params = ids
    ? `ids=${ids.join(",")}`
    : "ids=all";
  const wire = await fetchJson<BoardWireResponse>(`/api/board?${params}`, signal);
  if (!wire) return null;
  return convertBoardWire(wire);
}

export async function fetchTursoLeaderboard(
  signal?: AbortSignal,
): Promise<TursoLeaderboardResponse | null> {
  return fetchJson<TursoLeaderboardResponse>("/api/leaderboard", signal);
}

export async function fetchTursoStats(
  signal?: AbortSignal,
): Promise<TursoStatsResponse | null> {
  return fetchJson<TursoStatsResponse>("/api/stats", signal);
}
