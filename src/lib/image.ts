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

/** Target budget we try to hit while compressing (leaves room for a zone tag). */
const TARGET_BYTES = 10 * 1024;

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

/** Load a File into an HTMLImageElement. */
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

/**
 * Render `img` into a canvas whose longest side is `maxDim`.
 *
 * When `aspect` (width / height) is provided the output canvas is shaped to
 * that aspect ratio and the source image is *cover-fitted* (centred crop, no
 * distortion) into it — so a banner uploaded for a multi-plot zone is stored
 * already matching the zone's shape and the canvas renderer can stretch it 1:1.
 * Without `aspect` the source's own aspect ratio is preserved.
 */
function encode(
  img: HTMLImageElement,
  maxDim: number,
  mime: string,
  quality: number,
  aspect?: number,
): { dataUri: string; width: number; height: number } {
  let width: number;
  let height: number;
  if (aspect && aspect > 0) {
    if (aspect >= 1) {
      width = maxDim;
      height = Math.max(1, Math.round(maxDim / aspect));
    } else {
      height = maxDim;
      width = Math.max(1, Math.round(maxDim * aspect));
    }
  } else {
    const ratio = Math.min(
      1,
      maxDim / Math.max(img.naturalWidth, img.naturalHeight),
    );
    width = Math.max(1, Math.round(img.naturalWidth * ratio));
    height = Math.max(1, Math.round(img.naturalHeight * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Cover-fit: pick the centred source rectangle matching the dest aspect.
  const destAspect = width / height;
  const srcAspect = img.naturalWidth / img.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (srcAspect > destAspect) {
    sw = Math.round(sh * destAspect);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else if (srcAspect < destAspect) {
    sh = Math.round(sw / destAspect);
    sy = Math.round((img.naturalHeight - sh) / 2);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return { dataUri: canvas.toDataURL(mime, quality), width, height };
}

/**
 * Compress an uploaded image to a small data URI suitable for on-chain storage.
 * Tries decreasing quality, then decreasing dimensions, keeping the smallest
 * result. Always resolves; check `tooLarge` to know if it still won't fit.
 */
export async function compressImageFile(
  file: File,
  opts: { aspect?: number } = {},
): Promise<CompressResult> {
  const img = await loadImage(file);
  const mime = supportsWebp() ? "image/webp" : "image/jpeg";
  // Step dimensions / quality down until the data URI fits the on-chain budget
  // (~10 KB target). Larger sizes simply cost too much gas to store.
  const dims = [320, 256, 220, 192, 160, 128, 112, 96, 72, 56];
  const qualities = [0.84, 0.74, 0.64, 0.54, 0.44, 0.34, 0.28];
  const { aspect } = opts;

  let smallest: { dataUri: string; width: number; height: number } | null = null;

  for (const maxDim of dims) {
    for (const q of qualities) {
      const out = encode(img, maxDim, mime, q, aspect);
      if (!smallest || out.dataUri.length < smallest.dataUri.length) {
        smallest = out;
      }
      if (out.dataUri.length <= TARGET_BYTES) {
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
    tooLarge: best.dataUri.length > MAX_ONCHAIN_IMAGE_BYTES,
  };
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

const ZONE_RE = /#bb=(\d+),(\d+),(\d+),(\d+)$/;

/** Parse a `#bb=x1,y1,x2,y2` zone fragment, or null if absent. */
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

/** Remove any zone fragment, returning the bare image reference. */
export function stripZone(uri: string): string {
  return uri.replace(ZONE_RE, "");
}

/** Append (or replace) a zone fragment on an image reference. */
export function withZone(uri: string, z: Zone): string {
  return `${stripZone(uri)}#bb=${z.x1},${z.y1},${z.x2},${z.y2}`;
}
