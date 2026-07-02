import { NextRequest, NextResponse } from "next/server";
import { ensureTurso } from "@/lib/turso";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const x1 = parseInt(searchParams.get("x1") ?? "", 10);
    const y1 = parseInt(searchParams.get("y1") ?? "", 10);
    const x2 = parseInt(searchParams.get("x2") ?? "", 10);
    const y2 = parseInt(searchParams.get("y2") ?? "", 10);

    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
      return NextResponse.json(
        { error: "x1, y1, x2, y2 query params required" },
        { status: 400 },
      );
    }

    const db = ensureTurso();

    // IDs for the full viewport range — use OR conditions for efficiency.
    const rows: number[] = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        rows.push(y * 3162 + x);
      }
    }

    if (rows.length === 0) {
      return NextResponse.json([]);
    }

    // Build a bulk query with IN clause (Turso/libsql supports this).
    const placeholders = rows.map(() => "?").join(",");
    const result = await db.execute({
      sql: `SELECT plot_id, owner, price, is_for_sale, image_uri
            FROM ownership
            WHERE plot_id IN (${placeholders})
              AND owner != '0x0000000000000000000000000000000000000000'`,
      args: rows.map((r) => r),
    });

    const data = result.rows.map((r: Record<string, unknown>) => ({
      plotId: Number(r.plot_id),
      owner: String(r.owner ?? ""),
      price: String(r.price ?? "0"),
      isForSale: Number(r.is_for_sale) === 1,
      imageUri: String(r.image_uri ?? ""),
    }));

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
