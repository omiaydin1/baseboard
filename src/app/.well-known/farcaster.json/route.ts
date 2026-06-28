/**
 * Farcaster Mini App manifest served at `/.well-known/farcaster.json`.
 *
 * The URLs are derived from the incoming request host (or `NEXT_PUBLIC_APP_URL`)
 * so the manifest is always valid for whatever domain serves it — avoiding the
 * "Domain is not valid" error that hard-coding the wrong origin causes. CORS is
 * wide-open so Farcaster's crawlers / developer tools can fetch it cross-origin.
 *
 * NOTE: `accountAssociation` proves custody of the domain and must be generated
 * per-domain with Warpcast's manifest tool (Settings → Developer → Domains),
 * then pasted in via the `FARCASTER_*` env vars below. The manifest is still a
 * structurally valid, fetchable document without it.
 */

import { ICON_CACHE_BUST } from "@/lib/constants";

export const dynamic = "force-dynamic";

function baseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request) {
  const url = baseUrl(req);

  // Signed proof of domain custody (generated via Warpcast's manifest tool for
  // base-board-pixel.vercel.app). Env vars override for other domains.
  const accountAssociation = {
    header:
      process.env.FARCASTER_HEADER ??
      "eyJmaWQiOjEzNTY2NjIsInR5cGUiOiJhdXRoIiwia2V5IjoiMHgxNTUwQjBGRmY1NUVjMDU0NDgwMjREOTYxNmI5RDFFOTk5YTQ3RWYzIn0",
    payload:
      process.env.FARCASTER_PAYLOAD ??
      "eyJkb21haW4iOiJiYXNlLWJvYXJkLXBpeGVsLnZlcmNlbC5hcHAifQ",
    signature:
      process.env.FARCASTER_SIGNATURE ??
      "ZzxNz7F7o1DqSt/VQwsWDVCHzcetKGKSABALrz/cqU9uNfN3HMzm0NEhjmyMxPIT++hTbdaW/QFwSxw+3NeD/Bs=",
  };

  const manifest = {
    accountAssociation,
    frame: {
      version: "1",
      name: "BaseBoard",
      subtitle: "9,998,244 pixels on Base",
      description:
        "Buy, sell, trade and draw on a 9,998,244-pixel board on Base Mainnet.",
      iconUrl: `${url}/icon.png${ICON_CACHE_BUST}`,
      homeUrl: url,
      imageUrl: `${url}/og.png`,
      buttonTitle: "Open BaseBoard",
      splashImageUrl: `${url}/icon.png${ICON_CACHE_BUST}`,
      splashBackgroundColor: "#ffffff",
      primaryCategory: "art-creativity",
    },
  };

  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
