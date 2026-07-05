import { NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getLeaderboard, getRecentPurchases, getAllPlots } from "@/lib/turso";
import type { LeaderEntry, PurchaseEvent } from "@/hooks/useBaseBoard";

/**
 * Returns leaderboard ranking + recent purchase events.
 * Falls back to an empty response when Turso is not configured.
 */
export async function GET() {
  if (!isTursoConfigured()) {
    return NextResponse.json(
      { ranking: [], events: [], fromCache: false } satisfies AllMintedResponse,
    );
  }

  const client = await getTursoClient();
  if (!client) {
    return NextResponse.json(
      { ranking: [], events: [], fromCache: false } satisfies AllMintedResponse,
    );
  }

  try {
    const [rawLeaderboard, rawEvents] = await Promise.all([
      getLeaderboard(client, 100),
      getRecentPurchases(client, 20),
    ]);

    const ranking: LeaderEntry[] = rawLeaderboard.map((e) => ({
      owner: e.owner as `0x${string}`,
      count: e.count,
      tieBreakBlock: e.tieBreakBlock,
      rank: e.rank,
      baseName: e.baseName as string | null,
    }));

    const events: PurchaseEvent[] = rawEvents.map((e) => ({
      buyer: e.buyer as `0x${string}`,
      count: e.count,
      block: e.block,
      txHash: e.txHash,
    }));

    return NextResponse.json(
      { ranking, events, fromCache: true } satisfies AllMintedResponse,
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (err) {
    console.error("Leaderboard API error:", err);
    return NextResponse.json(
      { ranking: [], events: [], fromCache: false } satisfies AllMintedResponse,
      { status: 500 },
    );
  }
}

interface AllMintedResponse {
  ranking: LeaderEntry[];
  events: PurchaseEvent[];
  fromCache: boolean;
}
