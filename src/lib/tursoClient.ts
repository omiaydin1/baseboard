import type { Plot } from "./types";

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

export async function fetchTursoBoard(
  ids?: number[],
  signal?: AbortSignal,
): Promise<TursoBoardResponse | null> {
  const params = ids
    ? `ids=${ids.join(",")}`
    : "ids=all";
  return fetchJson<TursoBoardResponse>(`/api/board?${params}`, signal);
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
