import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, upsertPlot } from "@/lib/turso";

interface UpsertBody {
  plotId: number;
  owner: string;
  price: string;
  isForSale: boolean;
  imageUri: string;
}

export async function POST(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, error: "Turso not configured" }, { status: 500 });
  }

  const client = await getTursoClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "No client" }, { status: 500 });
  }

  try {
    const body: UpsertBody = await req.json();
    if (body.plotId == null || !body.owner) {
      return NextResponse.json({ ok: false, error: "Missing plotId or owner" }, { status: 400 });
    }

    await upsertPlot(
      client,
      body.plotId,
      body.owner,
      body.price || "0",
      body.isForSale ?? false,
      body.imageUri || "",
      Math.floor(Date.now() / 1000),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Upsert API error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
