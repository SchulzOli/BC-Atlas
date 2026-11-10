/**
 * Token-bucket rate limiter. Business Central itself enforces per-user limits
 * (HTTP 429); limiting at the gateway protects the shared service principal
 * from a single noisy client and slows down credential brute-forcing.
 */
export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** seconds until the bucket is full again */
  resetSec: number;
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  last: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #perMs: number;
  readonly enabled: boolean;

  constructor(perMinute: number, burst = perMinute) {
    this.enabled = perMinute > 0;
    this.#capacity = Math.max(1, burst);
    this.#perMs = perMinute / 60_000;
  }

  take(key: string, now = Date.now(), cost = 1): RateDecision {
    if (!this.enabled) return { allowed: true, limit: 0, remaining: 0, resetSec: 0, retryAfterSec: 0 };
    let b = this.#buckets.get(key);
    if (!b) {
      b = { tokens: this.#capacity, last: now };
      this.#buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.#capacity, b.tokens + (now - b.last) * this.#perMs);
      b.last = now;
    }
    const allowed = b.tokens >= cost;
    if (allowed) b.tokens -= cost;
    const missing = this.#capacity - b.tokens;
    return {
      allowed,
      limit: this.#capacity,
      remaining: Math.max(0, Math.floor(b.tokens)),
      resetSec: Math.ceil(missing / this.#perMs / 1000),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((cost - b.tokens) / this.#perMs / 1000)),
    };
  }

  /** Drop idle, refilled buckets to bound memory. */
  sweep(now = Date.now()): void {
    for (const [k, b] of this.#buckets) {
      if (b.tokens + (now - b.last) * this.#perMs >= this.#capacity) this.#buckets.delete(k);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }
}

export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  if (!d.limit) return {};
  const h: Record<string, string> = {
    'RateLimit-Limit': String(d.limit),
    'RateLimit-Remaining': String(d.remaining),
    'RateLimit-Reset': String(d.resetSec),
  };
  if (!d.allowed) h['Retry-After'] = String(d.retryAfterSec);
  return h;
}
