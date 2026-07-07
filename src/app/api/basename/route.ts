import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, getBasenames } from "@/lib/turso";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const addressesParam = req.nextUrl.searchParams.get("addresses");

  try {
    const turso = await getTursoClient();
    if (!turso) {
      return NextResponse.json(
        { error: "Turso not configured" },
        { status: 503 },
      );
    }

    if (address) {
      const addr = address.toLowerCase();
      const cached = await getBasenames(turso, [addr]);
      return NextResponse.json({
        address: addr,
        name: cached.get(addr) ?? null,
      });
    }

    if (addressesParam) {
      const rawAddresses = addressesParam
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.startsWith("0x"));
      const cached = await getBasenames(turso, rawAddresses);
      const names: Record<string, string | null> = {};
      for (const a of rawAddresses) {
        const key = a.toLowerCase();
        names[key] = cached.get(key) ?? null;
      }
      return NextResponse.json({ names });
    }

    return NextResponse.json(
      { error: "Missing 'address' or 'addresses' param" },
      { status: 400 },
    );
  } catch (err) {
    const e = err as any;
    console.error("Basename API error:", e.message ?? e);
    return NextResponse.json({ error: "Resolution failed" }, { status: 500 });
  }
}
