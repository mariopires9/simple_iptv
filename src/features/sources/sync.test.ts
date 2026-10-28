import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { startInitialSync } from './sync';

afterEach(() => {
  clearLogBuffer();
  vi.restoreAllMocks();
});

// TODO(SRC-07): once `@/worker` (syncXtream) is merged, test that the task is started instead.
describe('startInitialSync', () => {
  it('never rejects and logs a warning while the worker sync task is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(startInitialSync('source-1')).resolves.toBeUndefined();
    const warning = getLogEntries().find((e) => e.level === 'warn');
    expect(warning?.message).toMatch(/Initial sync/);
    expect(warning?.context).toContain('source-1');
  });
});
