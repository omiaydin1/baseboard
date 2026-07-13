import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, getBasenames } from "@/lib/turso";
import { checkRateLimit } from "@/lib/rateLimit";

function clientIp(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip ?? "unknown";
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Basename API error:", msg);
    return NextResponse.json({ error: "Resolution failed" }, { status: 500 });
  }
}
