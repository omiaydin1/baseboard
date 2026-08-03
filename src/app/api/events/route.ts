import { NextRequest, NextResponse } from "next/server";
import {
  getTursoClient,
  isTursoConfigured,
  getEvents,
  insertEvent,
  hasEventOverlap,
  getPlotIdsInBox,
  type EventRow,
} from "@/lib/turso";
import {
  DEV_LOCAL,
  EVENT_IMAGE_MAX_BYTES,
  EVENT_PRICE_PER_PIXEL_WEI,
  GRID_SIZE,
  MAX_EVENT_AREA,
  TREASURY_ADDRESS,
} from "@/lib/constants";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateLinkUrl } from "@/lib/image";

const MAX_BODY_BYTES = 1_500_000; // ~1 MB event image + overhead
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

interface CreateEventBody {
  title: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  image: string;
  link?: string;
  txHash: string;
}

function isAllowedOrigin(req: NextRequest): boolean {
  if (!APP_URL) return true;
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";
  return origin === APP_URL || referer.startsWith(APP_URL);
}

function clientIp(req: NextRequest): string {
  return (req as { ip?: string }).ip
    ?? req.headers.get("x-real-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

/** Strip quotes for safe JSON logging of hex results. */
function hexNum(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Verify the event-creation payment over RPC: a plain ETH transfer from the
 * creator's wallet to the treasury with exactly the 1/10-per-pixel amount.
 * The BaseBoard contract has no discounted fee hook (and is non-upgradable),
 * so the split happens off-chain: the buyer pays the normal price through the
 * contract, while event creation pays the treasury directly and is verified
 * here before the event is published. Skipped in dev-local mode (no chain).
 *
 * On success returns the transaction's sender address — that wallet IS the
 * event creator, since the payment must come from the creator's own wallet.
 */
async function verifyEventPayment(
  txHash: string,
  expectedWei: bigint,
): Promise<{ error: string } | { from: string }> {
  let txRes: Response;
  let txData: { result?: { from?: string; to?: string | null; value?: string } | null };
  try {
    txRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [txHash],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    txData = await txRes.json();
  } catch {
    return { error: "Payment could not be verified (RPC error). Please try again." };
  }
  const t = txData?.result;
  if (!t) return { error: "Payment transaction not found yet. Please wait a moment and try again." };
  if (t.to == null) return { error: "Invalid payment transaction." };
  if (t.to.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    return { error: "Payment must be sent to the BaseBoard treasury address." };
  }
  if (!t.from || !/^0x[0-9a-fA-F]{40}$/.test(t.from)) {
    return { error: "Invalid payment transaction." };
  }
  const value = hexNum(t.value);
  if (!value || BigInt(value) !== expectedWei) {
    return { error: "Payment amount does not match the event price. Please create a new event." };
  }

  try {
    const receiptRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const receiptData = await receiptRes.json();
    const receipt = receiptData?.result as { status?: string } | null;
    if (!receipt || receipt.status !== "0x1") {
      return { error: "Payment is still pending on-chain. Please wait and try again." };
    }
  } catch {
    return { error: "Payment could not be verified (RPC error). Please try again." };
  }
  return { from: t.from };
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isTursoConfigured()) {
    return NextResponse.json({ events: [] }, { status: 503 });
  }
  const client = await getTursoClient();
  if (!client) {
    return NextResponse.json({ events: [] }, { status: 503 });
  }
  try {
    const events: EventRow[] = await getEvents(client);
    return NextResponse.json(
      { events },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (err) {
    console.error("Events GET error:", err);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, error: "Turso not configured" }, { status: 500 });
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
    const body = JSON.parse(raw) as CreateEventBody;

    // --- title ---
    const title = (body.title ?? "").trim();
    if (!title || title.length > 60) {
      return NextResponse.json({ ok: false, error: "Title must be 1-60 characters" }, { status: 400 });
    }

    // --- bounding box ---
    const nums = [body.x1, body.y1, body.x2, body.y2];
    if (!nums.every((n) => Number.isInteger(n))) {
      return NextResponse.json({ ok: false, error: "Invalid region coordinates" }, { status: 400 });
    }
    const x1 = Math.min(body.x1, body.x2);
    const x2 = Math.max(body.x1, body.x2);
    const y1 = Math.min(body.y1, body.y2);
    const y2 = Math.max(body.y1, body.y2);
    if (x1 < 0 || x2 >= GRID_SIZE || y1 < 0 || y2 >= GRID_SIZE) {
      return NextResponse.json({ ok: false, error: "Region is outside the board" }, { status: 400 });
    }
    const area = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (area > MAX_EVENT_AREA) {
      return NextResponse.json(
        { ok: false, error: `Region too large — max ${MAX_EVENT_AREA.toLocaleString()} pixels` },
        { status: 400 },
      );
    }

    // --- image: data URIs only (remote URLs would CORS-fail the renderer) ---
    const image = (body.image ?? "").trim();
    if (!image.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Event image must be an uploaded image" }, { status: 400 });
    }
    if (image.length > EVENT_IMAGE_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Event image is too large" }, { status: 400 });
    }

    // --- link (optional, screened server-side) ---
    const linkCheck = validateLinkUrl(body.link ?? "");
    if (!linkCheck.ok) {
      return NextResponse.json({ ok: false, error: "Invalid or restricted link" }, { status: 400 });
    }
    const link = linkCheck.url ?? "";

    // --- payment tx hash ---
    const txHash = (body.txHash ?? "").trim();
    if (!TX_HASH_RE.test(txHash)) {
      return NextResponse.json({ ok: false, error: "Invalid transaction hash" }, { status: 400 });
    }

    // --- region must be fully unowned ---
    const owned = await getPlotIdsInBox(client, x1, y1, x2, y2);
    if (owned.length > 0) {
      return NextResponse.json(
        { ok: false, error: "This region contains purchased pixels — events need an empty area" },
        { status: 409 },
      );
    }

    // --- no overlap with existing events ---
    if (await hasEventOverlap(client, x1, y1, x2, y2)) {
      return NextResponse.json(
        { ok: false, error: "This region overlaps an existing event" },
        { status: 409 },
      );
    }

    // --- verify the treasury payment (resolves the creator from the tx) ---
    const expectedWei = EVENT_PRICE_PER_PIXEL_WEI * BigInt(area);
    let creator = "";
    if (!DEV_LOCAL) {
      const verified = await verifyEventPayment(txHash, expectedWei);
      if ("error" in verified) {
        return NextResponse.json({ ok: false, error: verified.error }, { status: 402 });
      }
      creator = verified.from;
    }

    const id = await insertEvent(
      client,
      {
        title,
        x1,
        y1,
        x2,
        y2,
        image,
        link,
        creator,
        txHash,
      },
      Math.floor(Date.now() / 1000),
    );

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("Events POST error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
