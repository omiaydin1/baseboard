import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getLeaderboard, getRecentPurchases, getAllPlots } from "@/lib/turso";
import type { LeaderEntry, PurchaseEvent } from "@/hooks/useBaseBoard";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Returns leaderboard ranking + recent purchase events.
 * Falls back to an empty response when Turso is not configured.
 */
function clientIp(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip ?? "unknown";
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ ranking: [], events: [], fromCache: false }, { status: 429 });
  }

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
      baseName: e.baseName ?? null,
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
