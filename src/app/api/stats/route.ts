import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getTotalPlotsSold } from "@/lib/turso";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Returns total plots sold from the Turso cache.
 * Falls back to "not available" when Turso is not configured.
 */
function clientIp(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip ?? "unknown";
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ sold: null, available: false }, { status: 429 });
  }

  if (!isTursoConfigured()) {
    return NextResponse.json(
      { sold: null, available: false } satisfies StatsResponse,
    );
  }

  const client = await getTursoClient();
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
