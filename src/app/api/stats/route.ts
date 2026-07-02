import { NextResponse } from "next/server";
import { ensureTurso } from "@/lib/turso";
import { DISPLAY_MAX_PLOTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = ensureTurso();
    const countResult = await db.execute(`
      SELECT COUNT(*) AS sold FROM ownership
      WHERE owner != '0x0000000000000000000000000000000000000000'
    `);
    const sold = Number(countResult.rows[0]?.sold ?? 0);
    const remaining = Math.max(0, DISPLAY_MAX_PLOTS - sold);
    return NextResponse.json({ sold, remaining }, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
