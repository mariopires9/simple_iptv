// SRC-05 AC2: the in-memory Xtream prefill handoff (router state carries only an opaque id).
import { describe, expect, it } from 'vitest';
import {
  XTREAM_PREFILL_STATE_KEY,
  clearXtreamPrefill,
  readXtreamPrefill,
  stashXtreamPrefill,
} from './prefill';

const VALUES = { server: 'http://h.example.test', username: 'u', password: 'secret-pass' };

describe('Xtream prefill handoff', () => {
  it('router state holds only an opaque id', () => {
    const state = stashXtreamPrefill(VALUES);
    expect(Object.keys(state)).toEqual([XTREAM_PREFILL_STATE_KEY]);
    expect(JSON.stringify(state)).not.toContain('secret-pass');
    expect(readXtreamPrefill(state)).toEqual(VALUES);
    // Reading does not consume (StrictMode double render).
    expect(readXtreamPrefill(state)).toEqual(VALUES);
    clearXtreamPrefill(state);
    expect(readXtreamPrefill(state)).toBeUndefined();
  });

  it('an unknown or stale id gets nothing, and does not clear newer values', () => {
    const old = stashXtreamPrefill(VALUES);
    const current = stashXtreamPrefill({ ...VALUES, username: 'v' });
    expect(readXtreamPrefill(old)).toBeUndefined();
    clearXtreamPrefill(old);
    expect(readXtreamPrefill(current)?.username).toBe('v');
    expect(readXtreamPrefill(null)).toBeUndefined();
    expect(readXtreamPrefill({ [XTREAM_PREFILL_STATE_KEY]: 'x' })).toBeUndefined();
  });
});
