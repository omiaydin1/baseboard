const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const CLEANUP_INTERVAL_MS = 300_000; // 5min — evict stale IP entries

const hits = new Map<string, number[]>();

// Periodically purge IPs with no recent activity to prevent unbounded growth.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [ip, timestamps] of hits) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) hits.delete(ip);
      else hits.set(ip, valid);
    }
  }, CLEANUP_INTERVAL_MS);
}

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let timestamps = hits.get(ip);
  if (!timestamps) {
    timestamps = [];
    hits.set(ip, timestamps);
  }

  const valid = timestamps.filter((t) => t > windowStart);
  valid.push(now);
  hits.set(ip, valid);

  return valid.length <= MAX_REQUESTS;
}
