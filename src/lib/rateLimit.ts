const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

const hits = new Map<string, number[]>();

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
