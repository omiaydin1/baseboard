import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  getTursoClient,
  isTursoConfigured,
  getEventById,
  updateEventLink,
} from "@/lib/turso";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateLinkUrl } from "@/lib/image";

/**
 * After creation, an event is immutable except for its LINK — the creator can
 * add or change the destination link (shown automatically on bought pixels),
 * but may not change the title, image or region. Ownership is proven with a
 * `personal_sign` signature over a fresh, timestamped message:
 * `update-event-link:<id>:<unixSeconds>` (accepted within a 5-minute window).
 */
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

interface PatchBody {
  link?: string;
  signature?: string;
  timestamp?: number;
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid event id" }, { status: 400 });
    }

    const event = await getEventById(client, numericId);
    if (!event) {
      return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
    }
    if (!event.creator) {
      return NextResponse.json(
        { ok: false, error: "This event's link cannot be edited" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    // --- link screening ---
    const linkCheck = validateLinkUrl(body.link ?? "");
    if (!linkCheck.ok) {
      return NextResponse.json({ ok: false, error: "Invalid or restricted link" }, { status: 400 });
    }
    const link = linkCheck.url ?? "";

    // --- fresh signature window ---
    const ts = body.timestamp;
    if (typeof ts !== "number" || !Number.isInteger(ts) || Math.abs(Date.now() - ts * 1000) > SIGNATURE_WINDOW_MS) {
      return NextResponse.json({ ok: false, error: "Signature expired — please try again" }, { status: 401 });
    }

    // --- owner proof ---
    const signature = body.signature ?? "";
    if (!signature) {
      return NextResponse.json({ ok: false, error: "Signature required" }, { status: 401 });
    }
    const message = `update-event-link:${numericId}:${ts}`;
    let valid = false;
    try {
      valid = await verifyMessage({
        address: event.creator as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      valid = false;
    }
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Signature does not match the event creator" }, { status: 401 });
    }

    await updateEventLink(client, numericId, link);
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    console.error("Events PATCH error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
