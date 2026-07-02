import { NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getTotalPlotsSold } from "@/lib/turso";

/**
 * Returns total plots sold from the Turso cache.
 * Falls back to "not available" when Turso is not configured.
 */
export async function GET() {
  if (!isTursoConfigured()) {
    return NextResponse.json(
      { sold: null, available: false } satisfies StatsResponse,
    );
  }

  const client = getTursoClient();
  if (!client) {
    return NextResponse.json(
      { sold: null, available: false } satisfies StatsResponse,
    );
  }

  try {
    const sold = await getTotalPlotsSold(client);
    return NextResponse.json(
      { sold, available: true } satisfies StatsResponse,
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (err) {
    console.error("Stats API error:", err);
    return NextResponse.json(
      { sold: null, available: false } satisfies StatsResponse,
      { status: 500 },
    );
  }
}

interface StatsResponse {
  sold: number | null;
  available: boolean;
}
