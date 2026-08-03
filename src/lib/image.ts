/**
 * Client-side image helpers.
 *
 * On-chain storage of an image's bytes is extremely expensive: storing a string
 * costs ~22k gas per 32-byte word, so a 60 KB data URI would need millions of
 * gas and the wallet refuses to build / simulate the transaction ("insufficient
 * resources"). To make device uploads actually succeed we aggressively downscale
 * and re-encode the picture so the resulting data URI fits in a small byte
 * budget before it is ever written to the contract.
 */

/**
 * Hard cap on the data-URI length we store on-chain (bytes).
 *
 * Storing a string costs ~22,100 gas per 32-byte word, so on-chain bytes map
 * almost linearly to gas: ~0.74M gas/KB (measured against the deployed
 * contract). A 12 KB image is ~8.9M gas — the largest that Coinbase Smart
 * Wallet / the Base bundler can reliably simulate; a 33 KB image runs out of
 * gas and the wallet reports "execution reverted". So device uploads (which are
 * embedded fully on-chain as data URIs) are capped here. Hosted http(s)/ipfs
 * URLs are NOT subject to this — only their short URL string is stored — so
 * paste a URL for high-resolution banners.
 */
export const MAX_ONCHAIN_IMAGE_BYTES = 12 * 1024;

/**
 * Largest *source* file a user may pick before we compress it for the chain.
 * The on-chain payload is always downscaled to `MAX_ONCHAIN_IMAGE_BYTES`; this
 * only caps the original device upload so a multi-megabyte file is rejected
 * cleanly (and an API route, if added later, can mirror this with a `20mb`
 * `bodyParser.sizeLimit`). Raised to 20 MB per product requirements.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Longest-side ceiling (in CSS px) for the *decoded* bitmap before compression.
 * A phone photo can be 4000+ px on its longest side; decoding it at full
 * resolution allocates a huge bitmap and can OOM-crash mobile webviews. We cap
 * the decode to this dimension scaled by devicePixelRatio (clamped to 2×) using
 * `createImageBitmap`'s native resize. This is well above the ~640 px the
 * compressor ever needs, so it costs no visible quality.
 */
const DECODE_MAX_DIM = 768;

function decodeMaxDim(): number {
  const dpr =
    typeof window !== "undefined"
      ? Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      : 1;
  return Math.round(DECODE_MAX_DIM * dpr);
}

/**
 * Target budget we try to hit while compressing. Use almost the entire on-chain
 * cap (leaving a small margin for the `#bb=…&link=…` metadata fragment) so we
 * spend every available byte on image quality instead of leaving headroom idle.
 */
const TARGET_BYTES = MAX_ONCHAIN_IMAGE_BYTES - 768;

/**
 * Resolution budget per plot cell. An image only ever needs enough pixels to
 * look crisp across the *plots it covers* — a single plot is tiny on screen, so
 * encoding it at a huge resolution just bloats the on-chain data URI (and gas)
 * for no visible gain. We therefore size the encode to the selected bounding box.
 */
const PX_PER_PLOT = 128;
/** Never encode a longest side larger than this, however big the selection. */
const MAX_ZONE_DIM = 640;
/** Smallest longest-side we'll ever drop to while squeezing under the budget. */
const MIN_DIM = 48;

/**
 * Longest-side pixel target for an image that must cover a `plotsW × plotsH`
 * block of plots. Scales with the selection so a 1×1 stays tiny while a wide
 * banner gets more pixels — but always clamped so the data URI stays gas-safe.
 */
export function dimForPlots(plotsW: number, plotsH: number): number {
  const longest = Math.max(1, Math.round(plotsW), Math.round(plotsH));
  return Math.min(MAX_ZONE_DIM, Math.max(PX_PER_PLOT, longest * PX_PER_PLOT));
}

/** Build a descending longest-side ladder starting at `start`, down to MIN_DIM. */
function dimLadder(start: number): number[] {
  const top = Math.max(MIN_DIM, Math.min(Math.round(start), MAX_ZONE_DIM));
  const out: number[] = [];
  let d = top;
  while (d > MIN_DIM) {
    out.push(d);
    d = Math.round(d * 0.82);
  }
  out.push(MIN_DIM);
  return out;
}

export interface CompressResult {
  /** The compressed image as a `data:` URI ready to store on-chain. */
  dataUri: string;
  /** Byte length of `dataUri` (== on-chain string length). */
  bytes: number;
  /** Final encoded dimensions. */
  width: number;
  height: number;
  /** True when even the smallest attempt exceeded the hard cap. */
  tooLarge: boolean;
}

let _webpSupport: boolean | null = null;

/** Detect once whether this browser can encode WebP via <canvas>. */
function supportsWebp(): boolean {
  if (_webpSupport != null) return _webpSupport;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    _webpSupport = false;
  }
  return _webpSupport;
}

/** Load a File into an HTMLImageElement (fallback decode path). */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode that image"));
      img.src = typeof reader.result === "string" ? reader.result : "";
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/** A decoded, already-downsampled image source ready for re-encoding. */
interface DecodedImage {
  src: CanvasImageSource;
  width: number;
  height: number;
  /** Release any Bitmap memory held by the source. */
  close: () => void;
}

/**
 * Decode `file` with decode-time downsampling.
 *
 * Uses `createImageBitmap` with native `resize*` options so a multi-megapixel
 * photo is scaled down as part of decoding. The longest side is capped at
 * `decodeMaxDim()`. The intrinsic-size probe bitmap is `.close()`d immediately.
 * Falls back to an `<img>` decode where `createImageBitmap` is unavailable.
 * Always `.close()` the returned source when done.
 */
async function decodeDownsampled(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    // First pass to learn the intrinsic dimensions.
    const probe = await createImageBitmap(file);
    const longest = Math.max(probe.width, probe.height);
    const cap = decodeMaxDim();
    const scale = longest > cap ? cap / longest : 1;
    const resizeWidth = Math.max(1, Math.round(probe.width * scale));
    const resizeHeight = Math.max(1, Math.round(probe.height * scale));
    // Re-decode at the target resolution (explicitly, even when scale === 1).
    const bmp = await createImageBitmap(file, {
      resizeWidth,
      resizeHeight,
      resizeQuality: "high",
    });
    probe.close();
    return {
      src: bmp,
      width: bmp.width,
      height: bmp.height,
      close: () => bmp.close(),
    };
  }

  const img = await loadImage(file);
  return {
    src: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    close: () => {},
  };
}

/**
 * Re-encode `src` into a data URI whose longest side is at most `maxDim`,
 * always preserving the source's own aspect ratio (no cropping). Placement into
 * a multi-plot zone is handled at render time by stretching (object-fit: fill)
 * the stored picture to exactly fill the zone, so the bytes we store keep the
 * whole picture instead of a cover-cropped slice.
 */
function encode(
  src: DecodedImage,
  maxDim: number,
  mime: string,
  quality: number,
): { dataUri: string; width: number; height: number } {
  const ratio = Math.min(1, maxDim / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * ratio));
  const height = Math.max(1, Math.round(src.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.src, 0, 0, src.width, src.height, 0, 0, width, height);
  return { dataUri: canvas.toDataURL(mime, quality), width, height };
}

/**
 * Compress an uploaded image to a small data URI suitable for on-chain storage.
 * Tries decreasing quality, then decreasing dimensions, keeping the smallest
 * result. Always resolves; check `tooLarge` to know if it still won't fit.
 *
 * `targetBytes` overrides the byte budget the compressor squeezes under and
 * `hardCapBytes` defines what counts as `tooLarge` — used by the event image
 * flow, which stores images in Turso (no on-chain gas cost) and can therefore
 * afford a much larger payload than plot artwork.
 */
export async function compressImageFile(
  file: File,
  opts: { aspect?: number; maxDim?: number; targetBytes?: number; hardCapBytes?: number } = {},
): Promise<CompressResult> {
  const decoded = await decodeDownsampled(file);
  try {
    const mime = supportsWebp() ? "image/webp" : "image/jpeg";
    const { maxDim, targetBytes, hardCapBytes } = opts;
    const budget = targetBytes ?? TARGET_BYTES;
    const hardCap = hardCapBytes ?? MAX_ONCHAIN_IMAGE_BYTES;
    // Step dimensions / quality down until the data URI fits the byte budget
    // (~10 KB target for on-chain images; much larger for events). The ladder
    // starts at the resolution the *selected plots* actually need (so a 1×1
    // plot encodes tiny) and only shrinks from there.
    const dims = dimLadder(maxDim ?? 512);
    // Try high quality first at each size so we keep the crispest encode that
    // still fits the (now near-maximal) byte budget.
    const qualities = [0.94, 0.88, 0.82, 0.74, 0.64, 0.54, 0.44, 0.34, 0.28];

    let smallest: {
      dataUri: string;
      width: number;
      height: number;
    } | null = null;

    for (const dim of dims) {
      for (const q of qualities) {
        const out = encode(decoded, dim, mime, q);
        if (!smallest || out.dataUri.length < smallest.dataUri.length) {
          smallest = out;
        }
        if (out.dataUri.length <= budget) {
          return {
            dataUri: out.dataUri,
            bytes: out.dataUri.length,
            width: out.width,
            height: out.height,
            tooLarge: false,
          };
        }
      }
    }

    const best = smallest!;
    return {
      dataUri: best.dataUri,
      bytes: best.dataUri.length,
      width: best.width,
      height: best.height,
      tooLarge: best.dataUri.length > hardCap,
    };
  } finally {
    // Release the decoded bitmap immediately after baking the data URI.
    decoded.close();
  }
}

// ---------------------------------------------------------------------------
// Zone-encoded image URIs
//
// To render a single image across a multi-plot zone in ONE transaction, the
// bounding box of the selected plots is appended to the image reference as a URL
// fragment, e.g. `data:image/webp;base64,xxxx#bb=10,10,19,19`. Only the anchor
// (top-left) plot stores this string; the canvas reads the fragment to know how
// far to stretch the image. Fragments are ignored by the browser when the value
// is used as an <img> src, but we strip them defensively before loading.
// ---------------------------------------------------------------------------

export interface Zone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// `bb`/`link` can appear in any order in the fragment, each prefixed by `#`
// or `&`, e.g. `data:image/webp;base64,xxxx#bb=10,10,19,19&link=https%3A%2F%2F…`.
const ZONE_RE = /[#&]bb=(\d+),(\d+),(\d+),(\d+)/;
const LINK_RE = /[#&]link=([^&]+)/;

/** Parse a `bb=x1,y1,x2,y2` zone fragment, or null if absent. */
export function parseZone(uri: string): Zone | null {
  const m = uri.match(ZONE_RE);
  if (!m) return null;
  return {
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  };
}

/**
 * Resolve the spanning image/link covering grid cell (x, y) from a collection of
 * an owner's plots. A multi-plot image is stored only on its anchor plot with a
 * `#bb=x1,y1,x2,y2` zone fragment; every other covered pixel has an empty
 * `imageUri`. This scans the candidate plots for the anchor whose zone contains
 * (x, y) and returns its image + link. Shared by the canvas render path and the
 * Pixel Details modal so the two never drift apart. Returns null when no zone
 * covers the cell.
 */
export function resolveCoveringImage(
  plots: Iterable<{ imageUri?: string | null } | null | undefined>,
  x: number,
  y: number,
): { imageUri: string; link: string | null } | null {
  for (const p of plots) {
    const uri = p?.imageUri;
    if (!uri) continue;
    const z = parseZone(uri);
    if (!z) continue;
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) {
      return { imageUri: uri, link: parseLink(uri) };
    }
  }
  return null;
}

/** Parse a `link=<encoded url>` fragment, or null if absent. */
export function parseLink(uri: string): string | null {
  const m = uri.match(LINK_RE);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Remove any metadata fragment, returning the bare image reference. */
export function stripZone(uri: string): string {
  const i = uri.indexOf("#");
  return i === -1 ? uri : uri.slice(0, i);
}

/** Append (or replace) a zone fragment on an image reference. */
export function withZone(uri: string, z: Zone): string {
  return withMeta(uri, { zone: z });
}

/**
 * Build an image reference carrying optional zone + link metadata in a single
 * `#`-fragment. Both are kept on-chain in the existing `imageUri` string, so no
 * contract change is needed.
 */
export function withMeta(
  uri: string,
  meta: { zone?: Zone | null; link?: string | null },
): string {
  const base = stripZone(uri);
  const parts: string[] = [];
  if (meta.zone) {
    const { x1, y1, x2, y2 } = meta.zone;
    parts.push(`bb=${x1},${y1},${x2},${y2}`);
  }
  if (meta.link) parts.push(`link=${encodeURIComponent(meta.link)}`);
  return parts.length ? `${base}#${parts.join("&")}` : base;
}

// ---------------------------------------------------------------------------
// Content Security Guard — shared keyword/pattern list
//
// Used by both the link validator (`validateLinkUrl`) and the image content
// screener (OCR text scan). Single source of truth so the two checks never
// drift apart.
// ---------------------------------------------------------------------------

export const RESTRICTED_KEYWORDS = {
  keywords: [
  // pornography / adult
  "porn", "xxx", "xvideos", "xhamster", "pornhub", "redtube", "youporn",
  "onlyfans", "fansly", "brazzers", "nsfw", "hentai", "camgirl", "camsite",
  "escort", "sexcam", "sexchat", "sexshop", "adultfriendfinder", "chaturbate",
  "stripchat", "myfreecams", "fapello", "rule34",
  // drugs / narcotics
  "cocaine", "heroin", "meth", "cannabis", "marijuana", "weed-shop",
  "buyweed", "lsd", "mdma", "ketamine", "fentanyl", "psilocybin", "narcotic",
  "drugstore-illegal", "darknet", "silkroad",
  // alcohol / liquor
  "liquorstore", "buyalcohol", "vodka-shop", "whiskey-shop", "beershop",
  "winestore", "moonshine",
  // gambling / betting
  "casino", "betting", "gambl", "poker", "roulette", "blackjack", "baccarat",
  "slots", "sportsbet", "sportsbook", "bet365", "1xbet", "stake.com",
  "pokerstars", "wager",
  // phishing / malware
  "phishing", "free-crypto", "airdrop-claim", "wallet-verify", "seed-phrase",
  "metamask-support", "connect-wallet-verify", "claim-reward", "double-your",
  ],
  patterns: [
    // pornography / adult
    /porn\w*/,
    /\bx{3,}\b/,
    /sex(?:y|ual|cam|chat|shop|tube|video|work)/,
    /\bnudes?\b/,
    /\bn[\W_]?s[\W_]?f[\W_]?w\b/,
    /\b(?:milf|bdsm|fetish|camgirls?|escorts?)\b/,
    /\.(?:xxx|porn|adult|sex|cam|tube)(?:[/:?#]|$)/,
    // gambling / betting
    /\b(?:gambl|bett?ing|wager|roulette|blackjack|baccarat|slots?|jackpot)\w*/,
    /\b(?:casino|sportsbook|sportsbet)\w*/,
    /\b\d?x?bet\b/,
    // drugs / narcotics
    /\b(?:cocaine|heroin|meth(?:amphetamine)?|mdma|lsd|ketamine|fentanyl|psilocybin|cannabis|marijuana|narcotics?)\b/,
    /\bbuy[-_]?(?:weed|drugs|coke|meth)\b/,
    // alcohol / liquor
    /\b(?:vodka|whiske?y|tequila|liquor|moonshine|absinthe)\b/,
    // phishing / wallet-drainer structures
    /seed[\W_]?phrase|private[\W_]?key/,
    /wallet[\W_]?(?:verify|validate|connect|restore|sync)/,
    /(?:airdrop|reward|nft|crypto|eth|usdt)[\W_]?claim/,
    /claim[\W_]?(?:airdrop|reward|free)/,
    /free[\W_]?(?:crypto|eth|nft|mint)/,
  ],
};

export interface UrlValidationResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

/**
 * Validate a user-supplied destination link. Returns the normalized URL when
 * safe, or `ok:false` for blocked/malformed input. Empty input is allowed
 * (links are optional) and returns `ok:true` with no url.
 */
export function validateLinkUrl(raw: string): UrlValidationResult {
  const value = raw.trim();
  if (!value) return { ok: true };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Only allow real web links.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }

  const haystack =
    `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (RESTRICTED_KEYWORDS.keywords.some((kw) => haystack.includes(kw))) {
    return { ok: false, reason: "blocked" };
  }
  if (RESTRICTED_KEYWORDS.patterns.some((re) => re.test(haystack))) {
    return { ok: false, reason: "blocked" };
  }

  return { ok: true, url: parsed.toString() };
}

// NOTE: Image content screening (NSFW.js + OCR) lives in
// src/lib/imageModeration.ts (loaded from CDN at runtime, never bundled).
// This file keeps RESTRICTED_KEYWORDS, validateLinkUrl, and all other
// plain-logic utilities that may legitimately be imported server-side.
