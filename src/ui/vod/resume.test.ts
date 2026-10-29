// VOD-03 AC2/AC3: resume and completion policy.
import { describe, expect, it } from 'vitest';
import {
  COMPLETED_FRACTION,
  RESUME_MIN_SEC,
  isCompleted,
  progressSnapshot,
  resumePosition,
  watchedFraction,
} from './resume';

describe('resumePosition', () => {
  it.each([
    ['nothing saved', undefined, undefined],
    ['below 1 min', { positionSec: 59, durationSec: 5400, completed: false }, undefined],
    ['exactly 1 min', { positionSec: 60, durationSec: 5400, completed: false }, 60],
    ['mid-way', { positionSec: 754, durationSec: 5400, completed: false }, 754],
    ['exactly 95 % (included)', { positionSec: 95, durationSec: 100, completed: false }, 95],
    ['95 % of a long one', { positionSec: 5130, durationSec: 5400, completed: false }, 5130],
    ['beyond 95 %', { positionSec: 5131, durationSec: 5400, completed: false }, undefined],
    ['completed', { positionSec: 600, durationSec: 5400, completed: true }, undefined],
    ['unknown duration', { positionSec: 600, completed: false }, 600],
    ['NaN', { positionSec: Number.NaN, completed: false }, undefined],
  ] as const)('%s', (_, entry, expected) => {
    expect(resumePosition(entry)).toBe(expected);
  });

  it('uses the documented thresholds', () => {
    expect(RESUME_MIN_SEC).toBe(60);
    expect(COMPLETED_FRACTION).toBe(0.95);
  });
});

describe('progressSnapshot / isCompleted', () => {
  it('rounds and marks > 95 % as completed', () => {
    expect(progressSnapshot(754.6, 5400.4)).toEqual({
      positionSec: 754,
      durationSec: 5400,
      completed: false,
    });
    expect(progressSnapshot(5200, 5400)).toMatchObject({ completed: true });
    expect(isCompleted(95, 100)).toBe(false);
    expect(isCompleted(96, 100)).toBe(true);
  });

  it('`ended` always completes; no duration is omitted', () => {
    expect(progressSnapshot(10, undefined, true)).toEqual({ positionSec: 10, completed: true });
    expect(progressSnapshot(10, Number.POSITIVE_INFINITY)).toEqual({
      positionSec: 10,
      completed: false,
    });
  });
});

describe('watchedFraction', () => {
  it('only for unfinished entries with a position and duration', () => {
    expect(watchedFraction({ positionSec: 30, durationSec: 120, completed: false })).toBe(0.25);
    expect(watchedFraction({ positionSec: 30, durationSec: 120, completed: true })).toBeUndefined();
    expect(watchedFraction({ positionSec: 30, completed: false })).toBeUndefined();
    expect(watchedFraction({ positionSec: 0, durationSec: 120, completed: false })).toBeUndefined();
    expect(watchedFraction(undefined)).toBeUndefined();
  });
});
