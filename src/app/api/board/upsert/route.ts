import { NextRequest, NextResponse } from "next/server";
import { getTursoClient, isTursoConfigured, upsertPlot } from "@/lib/turso";
import { TOTAL_PLOTS } from "@/lib/constants";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_BODY_BYTES = 1024;
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface UpsertBody {
  plotId: number;
  owner: string;
  price: string;
  isForSale: boolean;
  imageUri: string;
}

function isHex(s: string): boolean {
  return /^[a-fA-F0-9]+$/.test(s);
}

const UPSERT_API_KEY = process.env.UPSERT_API_KEY ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function isAllowedOrigin(req: NextRequest): boolean {
  if (!APP_URL) return true;
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";
  return origin === APP_URL || referer.startsWith(APP_URL);
}

function clientIp(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip ?? "unknown";
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, error: "Turso not configured" }, { status: 500 });
  }

  if (UPSERT_API_KEY) {
    const key = req.headers.get("x-api-key") ?? "";
    if (key !== UPSERT_API_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  } else if (!isAllowedOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const client = await getTursoClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "No client" }, { status: 500 });
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "Request too large" }, { status: 413 });
    }

    const body: UpsertBody = JSON.parse(raw);

    // plotId: required, integer, within grid range
    if (body.plotId == null || !Number.isInteger(body.plotId) || body.plotId < 0 || body.plotId >= TOTAL_PLOTS) {
      return NextResponse.json({ ok: false, error: "Invalid plotId" }, { status: 400 });
    }

    // owner: required, valid Ethereum address
    if (!body.owner || !ETH_ADDRESS_RE.test(body.owner)) {
      return NextResponse.json({ ok: false, error: "Invalid owner address" }, { status: 400 });
    }

    // price: optional, must be valid numeric string if provided
    if (body.price != null && body.price !== "" && !/^\d+(\.\d+)?$/.test(body.price)) {
      return NextResponse.json({ ok: false, error: "Invalid price" }, { status: 400 });
    }

    // isForSale: optional boolean
    // imageUri: optional, length check
    if (body.imageUri && body.imageUri.length > 4096) {
      return NextResponse.json({ ok: false, error: "imageUri too long" }, { status: 400 });
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
