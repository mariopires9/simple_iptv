// SRC-07 AC5: the scheduled refresh starts once per session, when the app is idle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetStartupSyncForTests, scheduleStartupSync, type ScheduleIdle } from './startupSync';

afterEach(() => resetStartupSyncForTests());

function manualIdle() {
  const callbacks: (() => void)[] = [];
  const cancelled = vi.fn();
  const schedule: ScheduleIdle = (callback) => {
    callbacks.push(callback);
    return cancelled;
  };
  return { schedule, cancelled, runIdle: () => callbacks.splice(0).forEach((cb) => cb()) };
}

describe('scheduleStartupSync', () => {
  it('starts the due syncs when idle, not before', () => {
    const idle = manualIdle();
    const start = vi.fn(() => Promise.resolve());
    scheduleStartupSync(start, idle.schedule);
    expect(start).not.toHaveBeenCalled();
    idle.runIdle();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('only once per session (re-mounts do not start it again)', () => {
    const idle = manualIdle();
    const start = vi.fn(() => Promise.resolve());
    scheduleStartupSync(start, idle.schedule);
    scheduleStartupSync(start, idle.schedule);
    idle.runIdle();
    scheduleStartupSync(start, idle.schedule);
    idle.runIdle();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('cleanup before idle cancels; a later mount still schedules it', () => {
    const idle = manualIdle();
    const start = vi.fn(() => Promise.resolve());
    const cancel = scheduleStartupSync(start, idle.schedule);
    cancel();
    expect(idle.cancelled).toHaveBeenCalled();
    scheduleStartupSync(start, idle.schedule);
    idle.runIdle();
    expect(start).toHaveBeenCalled();
  });

  it('a failure to start is logged, not thrown', async () => {
    const idle = manualIdle();
    const start = vi.fn(() => Promise.reject(new Error('no worker')));
    scheduleStartupSync(start, idle.schedule);
    expect(() => idle.runIdle()).not.toThrow();
    await Promise.resolve();
  });
});
