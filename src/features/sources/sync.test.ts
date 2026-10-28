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

const warnings = () => getLogEntries().filter((e) => e.level === 'warn');

describe('startInitialSync', () => {
  it('dispatches the syncXtream worker task and resolves "started" without waiting for it', async () => {
    runTask.mockReturnValue(new Promise(() => undefined)); // a long sync
    await expect(startInitialSync('source-1')).resolves.toBe('started');
    expect(runTask).toHaveBeenCalledWith('syncXtream', { sourceId: 'source-1' });
  });

  it('a sync that fails later is logged, never rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runTask.mockRejectedValue(new Error('Worker task failed'));
    await expect(startInitialSync('source-1')).resolves.toBe('started');
    await vi.waitFor(() => expect(warnings()[0]?.message).toBe('Initial sync failed'));
    expect(warnings()[0]?.context).toContain('source-1');
  });

  it('a task that cannot be started → "unavailable" (no false "loading" claim)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runTask.mockImplementation(() => {
      throw new Error('Unknown task');
    });
    await expect(startInitialSync('source-1')).resolves.toBe('unavailable');
    expect(warnings()[0]?.message).toBe('Initial sync could not be started');
  });
});
