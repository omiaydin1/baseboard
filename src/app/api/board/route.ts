import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, getPlotBatch, getAllPlots } from "@/lib/turso";

/**
 * Wire format for Turso-served plot data. `price` is a decimal string because
 * JSON cannot natively serialize BigInt; the client converts it back to BigInt.
 */
interface PlotWire {
  owner: string;
  price: string;
  isForSale: boolean;
  imageUri: string;
}

interface BoardResponse {
  plots: Record<number, PlotWire>;
  fromCache: boolean;
}

/**
 * Returns a batch of plot state from the Turso cache. Accepts a query param
 * `ids` — a comma-separated list of plot ids — and returns their current owner,
 * price, isForSale and imageUri. Falls back to an empty map when Turso is not
 * configured.
 *
 * GET /api/board?ids=1,2,3
 * GET /api/board?ids=all            — returns ALL owned plots
 * GET /api/board?ids=all&since=123  — only plots updated after timestamp
 */
export async function GET(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ plots: {}, fromCache: false } satisfies BoardResponse);
  }

  const client = await getTursoClient();
  if (!client) {
    return NextResponse.json({ plots: {}, fromCache: false } satisfies BoardResponse);
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  const sinceParam = req.nextUrl.searchParams.get("since");

  try {
    let rows: Awaited<ReturnType<typeof getPlotBatch>>;

    if (idsParam === "all") {
      // `sinceParam` client'tan milisaniye olarak gelir; Turso'daki
      // `updated_at` saniye cinsinden kaydedilir, bu yüzden bölüyoruz.
      const since = sinceParam ? Math.floor(Number(sinceParam) / 1000) : undefined;
      rows = await getAllPlots(client, since);
    } else {
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
      rows = await getPlotBatch(client, ids);
    }

    // price is a decimal string (JSON-safe); client converts to BigInt.
    const plots: Record<number, PlotWire> = {};
    for (const row of rows) {
      plots[row.plotId] = {
        owner: row.owner,
        price: row.price,
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
