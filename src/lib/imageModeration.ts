/**
 * Client-only image content screening.
 *
 * Loads nsfwjs and tesseract.js from CDN via <script> tags at runtime to
 * avoid bundling ~4MB+ of TensorFlow.js into the webpack dependency graph.
 *
 * Both packages are *uninstalled* from package.json — the webpack minifier
 * must never see them, or it crashes with _webpack.WebpackError is not a
 * constructor (Next.js 15.5.19 minify-webpack-plugin bug).
 *
 * Only the first call to each function injects the <script> tags; subsequent
 * calls reuse the cached promise / global.
 */
import { RESTRICTED_KEYWORDS } from "./image";

// ---------------------------------------------------------------------------
// CDN loader
// ---------------------------------------------------------------------------

const TF_CDN =
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js";
const NSFW_CDN =
  "https://cdn.jsdelivr.net/npm/nsfwjs@latest/dist/nsfwjs.min.js";
const TESS_CDN =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let _loadPromise: Promise<void> | null = null;
let _nsfwModelPromise: Promise<any> | null = null;
let _tessReadyPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureTfjsLoaded(): Promise<void> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    await loadScript(TF_CDN);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        (window as any).tf ? resolve() : requestAnimationFrame(check);
      };
      check();
    });
    await loadScript(NSFW_CDN);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        (window as any).nsfwjs ? resolve() : requestAnimationFrame(check);
      };
      check();
    });
  })();
  return _loadPromise;
}

async function getNsfwModel(): Promise<any> {
  if (_nsfwModelPromise) return _nsfwModelPromise;
  _nsfwModelPromise = (async () => {
    await ensureTfjsLoaded();
    const model = await (window as any).nsfwjs.load();
    return model;
  })();
  return _nsfwModelPromise;
}

async function ensureTesseractLoaded(): Promise<void> {
  if (_tessReadyPromise) return _tessReadyPromise;
  _tessReadyPromise = (async () => {
    await loadScript(TESS_CDN);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        (window as any).Tesseract ? resolve() : requestAnimationFrame(check);
      };
      check();
    });
  })();
  return _tessReadyPromise;
}

// ---------------------------------------------------------------------------
// NSFW classification
// ---------------------------------------------------------------------------

export async function classifyImageNsfw(
  file: File,
): Promise<{ blocked: boolean; reason?: string }> {
  const model = await getNsfwModel();
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Could not decode image for NSFW scan"));
      img.src = url;
    });
    const predictions = await model.classify(img);
    for (const p of predictions) {
      if (
        (p.className === "Porn" || p.className === "Hentai") &&
        p.probability > 0.7
      ) {
        return { blocked: true, reason: "explicit" };
      }
    }
    return { blocked: false };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// OCR text extraction & keyword screening
// ---------------------------------------------------------------------------

async function extractImageText(file: File): Promise<string> {
  await ensureTesseractLoaded();
  const Tesseract = (window as any).Tesseract;
  const worker = await Tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return (data.text ?? "").toLowerCase();
  } finally {
    await worker.terminate();
  }
}

export async function screenImageText(
  file: File,
): Promise<{ blocked: boolean; reason?: string }> {
  const text = await extractImageText(file);
  if (RESTRICTED_KEYWORDS.keywords.some((kw) => text.includes(kw))) {
    return { blocked: true, reason: "restricted_content" };
  }
  if (RESTRICTED_KEYWORDS.patterns.some((re) => re.test(text))) {
    return { blocked: true, reason: "restricted_content" };
  }
  return { blocked: false };
}
