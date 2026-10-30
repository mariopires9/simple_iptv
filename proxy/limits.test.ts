// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createBadTokenLimiter, createRateLimiter } from './limits.ts';

describe('rate limiter', () => {
  it('allows perMinute requests, then refills over time', () => {
    let now = 0;
    const limiter = createRateLimiter(60, () => now);
    for (let i = 0; i < 60; i++) expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
    now += 1000;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
  });
});

describe('bad-token limiter', () => {
  it('locks for 60 s after maxFailures within a minute', () => {
    let now = 0;
    const limiter = createBadTokenLimiter(3, () => now);
    limiter.recordFailure();
    limiter.recordFailure();
    expect(limiter.isLocked()).toBe(false);
    limiter.recordFailure();
    expect(limiter.isLocked()).toBe(true);
    now += 59_999;
    expect(limiter.isLocked()).toBe(true);
    now += 1;
    expect(limiter.isLocked()).toBe(false);
  });

  it('forgets failures older than a minute', () => {
    let now = 0;
    const limiter = createBadTokenLimiter(2, () => now);
    limiter.recordFailure();
    now += 61_000;
    limiter.recordFailure();
    expect(limiter.isLocked()).toBe(false);
  });
});
