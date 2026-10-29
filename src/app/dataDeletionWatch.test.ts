// SRC-10: a tab told that another tab deleted all data locks its database, then restarts.
import { describe, expect, it, vi } from 'vitest';
import { installDataDeletionWatch } from './dataDeletionWatch';

describe('installDataDeletionWatch', () => {
  it('on the announcement: locks the database first, then restarts on onboarding', async () => {
    let fire: () => void = () => undefined;
    const order: string[] = [];
    const stop = vi.fn();
    const result = installDataDeletionWatch({
      watch: (onDeleted) => {
        fire = onDeleted;
        return stop;
      },
      lock: async () => void order.push('lock'),
      restart: () => order.push('restart'),
    });
    expect(order).toEqual([]);
    fire();
    await vi.waitFor(() => expect(order).toEqual(['lock', 'restart']));
    result();
    expect(stop).toHaveBeenCalled();
  });

  it('restarts even if the lock fails', async () => {
    let fire: () => void = () => undefined;
    const restart = vi.fn();
    installDataDeletionWatch({
      watch: (onDeleted) => {
        fire = onDeleted;
        return () => undefined;
      },
      lock: () => Promise.reject(new Error('no db')),
      restart,
    });
    fire();
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });
});
