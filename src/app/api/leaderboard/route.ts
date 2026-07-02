import { NextResponse } from "next/server";
import { ensureTurso } from "@/lib/turso";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = ensureTurso();
    const result = await db.execute(`
      SELECT o.plot_id, o.owner, o.image_uri, o.is_for_sale, o.price
      FROM ownership o
      WHERE o.owner != '0x0000000000000000000000000000000000000000'
      ORDER BY o.plot_id ASC
    `);
    const data = result.rows.map((r: Record<string, unknown>) => ({
      plotId: Number(r.plot_id),
      owner: String(r.owner ?? ""),
      imageUri: String(r.image_uri ?? ""),
      isForSale: Number(r.is_for_sale) === 1,
      price: String(r.price ?? "0"),
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
