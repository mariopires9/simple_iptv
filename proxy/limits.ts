// Rate limits (PRX-01). Both limiters are global: behind Tailscale Serve every request comes from
// 127.0.0.1, so there is no meaningful per-peer key.

export type Clock = () => number;

/** Token bucket: `perMinute` capacity, refilled continuously at `perMinute / 60` per second. */
export function createRateLimiter(perMinute: number, now: Clock = Date.now) {
  let tokens = perMinute;
  let last = now();
  return {
    /** Takes one token; false when the bucket is empty. */
    take(): boolean {
      const current = now();
      tokens = Math.min(perMinute, tokens + ((current - last) / 60_000) * perMinute);
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/**
 * Bad-token limiter: after `maxFailures` failed token checks within a minute, every request is
 * refused (429) for 60 seconds.
 */
export function createBadTokenLimiter(maxFailures: number, now: Clock = Date.now) {
  const windowMs = 60_000;
  let failures: number[] = [];
  let lockedUntil = 0;
  return {
    isLocked(): boolean {
      return now() < lockedUntil;
    },
    recordFailure(): void {
      const current = now();
      failures = failures.filter((t) => current - t < windowMs);
      failures.push(current);
      if (failures.length >= maxFailures) {
        lockedUntil = current + windowMs;
        failures = [];
      }
    },
  };
}
