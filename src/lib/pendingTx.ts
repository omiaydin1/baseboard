/**
 * Pending-transaction persistence for in-app webviews.
 *
 * The BaseApp / Coinbase Wallet in-app browser can reload or evict the page
 * while a wallet hands a signed transaction back, which would otherwise drop the
 * "waiting for confirmation" state and leave the user unsure whether their
 * purchase landed. We stash the latest pending tx hash in `sessionStorage` so a
 * fresh page load can pick the receipt watch back up and report the outcome.
 *
 * sessionStorage (not localStorage) is deliberate: the record is scoped to the
 * tab/session and shouldn't outlive it.
 */

const KEY = "baseboard:pendingTx";

export interface PendingTx {
  hash: `0x${string}`;
  chainId: number;
  /** Human label for the toast shown on recovery, e.g. "Purchase". */
  label: string;
  /** Epoch ms when it was recorded — used to expire stale records. */
  at: number;
}

/** Records older than this are ignored on recovery (likely already mined). */
const MAX_AGE_MS = 10 * 60 * 1000;

function safeSession(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingTx(tx: Omit<PendingTx, "at">): void {
  const s = safeSession();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ ...tx, at: Date.now() }));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export function clearPendingTx(): void {
  const s = safeSession();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}

/** Read a still-fresh pending tx, clearing (and ignoring) stale records. */
export function readPendingTx(): PendingTx | null {
  const s = safeSession();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingTx;
    if (
      !parsed?.hash ||
      typeof parsed.chainId !== "number" ||
      typeof parsed.at !== "number"
    ) {
      s.removeItem(KEY);
      return null;
    }
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      s.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
