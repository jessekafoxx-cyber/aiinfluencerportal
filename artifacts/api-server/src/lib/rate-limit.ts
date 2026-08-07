type Bucket = {
  timestamps: number[];
};

export type RateLimitWindow = {
  windowMs: number;
  max: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; window: RateLimitWindow };

const stores = new Map<string, Map<string, Bucket>>();

function getStore(name: string): Map<string, Bucket> {
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
}

export function checkRateLimit(
  name: string,
  key: string,
  windows: RateLimitWindow[],
): RateLimitResult {
  const store = getStore(name);
  const now = Date.now();
  const longestWindow = Math.max(...windows.map((w) => w.windowMs));

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    store.set(key, bucket);
  }

  const cutoff = now - longestWindow;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  for (const w of windows) {
    const since = now - w.windowMs;
    const count = bucket.timestamps.reduce(
      (n, t) => (t > since ? n + 1 : n),
      0,
    );
    if (count >= w.max) {
      const oldest =
        bucket.timestamps.find((t) => t > since) ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + w.windowMs - now) / 1000),
      );
      return { ok: false, retryAfterSec, window: w };
    }
  }

  bucket.timestamps.push(now);

  // Opportunistic GC: if the store grows large, drop empty buckets.
  if (store.size > 10000) {
    for (const [k, b] of store) {
      if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1]! < cutoff) {
        store.delete(k);
      }
    }
  }

  return { ok: true };
}
