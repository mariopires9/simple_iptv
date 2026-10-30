// EXP-01 — lists queued for a sync after an import: ids only, deduplicated, taken once.
import { afterEach, describe, expect, it } from 'vitest';
import { markSourcesForSync, PENDING_SYNC_KEY, takeSourcesPendingSync } from './pendingSync';

afterEach(() => sessionStorage.clear());

describe('pendingSync (EXP-01)', () => {
  it('queues ids, deduplicates, and empties on take', () => {
    markSourcesForSync(['a', 'b']);
    markSourcesForSync(['b', 'c']);
    expect(takeSourcesPendingSync()).toEqual(['a', 'b', 'c']);
    expect(takeSourcesPendingSync()).toEqual([]);
  });

  it('ignores a corrupt stored value', () => {
    sessionStorage.setItem(PENDING_SYNC_KEY, '{"not":"a list"}');
    expect(takeSourcesPendingSync()).toEqual([]);
    sessionStorage.setItem(PENDING_SYNC_KEY, '["ok", 3, ""]');
    expect(takeSourcesPendingSync()).toEqual(['ok']);
  });
});
