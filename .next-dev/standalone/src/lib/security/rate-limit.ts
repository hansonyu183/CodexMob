interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const nextBucket: Bucket = {
        count: 1,
        resetAt: now + this.windowMs,
      };
      this.buckets.set(key, nextBucket);
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        retryAfterMs: this.windowMs,
      };
    }

    if (bucket.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, bucket.resetAt - now),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - bucket.count),
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  resetForTests() {
    this.buckets.clear();
  }
}

