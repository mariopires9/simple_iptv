import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { startInitialSync } from './sync';

const runTask = vi.fn();
vi.mock('@/worker', () => ({ runTask: (...args: unknown[]) => runTask(...args) }));

afterEach(() => {
  clearLogBuffer();
  runTask.mockReset();
  vi.restoreAllMocks();
});

describe('startInitialSync', () => {
  it('starts the syncXtream worker task for the new source', async () => {
    runTask.mockResolvedValue({ status: 'ok' });
    await startInitialSync('source-1');
    expect(runTask).toHaveBeenCalledWith('syncXtream', { sourceId: 'source-1' });
  });

  it('never rejects and logs a warning when the sync fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runTask.mockRejectedValue(new Error('Worker task failed'));
    await expect(startInitialSync('source-1')).resolves.toBeUndefined();
    const warning = getLogEntries().find((e) => e.level === 'warn');
    expect(warning?.message).toBe('Initial sync failed');
    expect(warning?.context).toContain('source-1');
  });
});
