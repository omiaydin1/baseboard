import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getPlotBatch } from "@/lib/turso";
import type { Plot } from "@/lib/types";

/**
 * Returns a batch of plot state from the Turso cache. Accepts a query param
 * `ids` — a comma-separated list of plot ids — and returns their current owner,
 * price, isForSale and imageUri. Falls back to an empty map when Turso is not
 * configured.
 *
 * GET /api/board?ids=1,2,3
 */
export async function GET(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ plots: {}, fromCache: false } satisfies BoardResponse);
  }

  const client = getTursoClient();
  if (!client) {
    return NextResponse.json({ plots: {}, fromCache: false } satisfies BoardResponse);
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json(
      { error: "Missing 'ids' query param" },
      { status: 400 },
    );
  }

  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n) && n >= 0);

  if (ids.length === 0) {
    return NextResponse.json({ plots: {}, fromCache: false } satisfies BoardResponse);
  }

  try {
    const rows = await getPlotBatch(client, ids);
    const plots: Record<number, Plot> = {};
    for (const row of rows) {
      plots[row.plotId] = {
        owner: row.owner as `0x${string}`,
        price: BigInt(row.price),
        isForSale: row.isForSale,
        imageUri: row.imageUri,
      };
    }
    return NextResponse.json(
      { plots, fromCache: true } satisfies BoardResponse,
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (err) {
    console.error("Board API error:", err);
    return NextResponse.json(
      { plots: {}, fromCache: false } satisfies BoardResponse,
      { status: 500 },
    );
  }
}

interface BoardResponse {
  plots: Record<number, Plot>;
  fromCache: boolean;
}
