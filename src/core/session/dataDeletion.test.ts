// @vitest-environment node
// SRC-10: the "data deleted" announcement between tabs (real BroadcastChannel of Node).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  announceDataDeleted,
  DATA_DELETED_MESSAGE,
  dataDeletionChannelName,
  watchDataDeletion,
} from './dataDeletion';

const SCOPE = 'https://user.example.test/simple_iptv/';
const factory = (name: string) => new BroadcastChannel(name);
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const nextTick = () => new Promise((r) => setTimeout(r, 20));

describe('data deletion across tabs', () => {
  it('another tab of the same app is told; the announcing tab is not', async () => {
    const other = vi.fn();
    stops.push(watchDataDeletion(other, factory, SCOPE));
    announceDataDeleted(factory, SCOPE);
    await vi.waitFor(() => expect(other).toHaveBeenCalledTimes(1));
  });

  it('the channel is scoped to the app: another app on the same origin is not told', async () => {
    const otherApp = vi.fn();
    stops.push(watchDataDeletion(otherApp, factory, 'https://user.example.test/other_app/'));
    announceDataDeleted(factory, SCOPE);
    await nextTick();
    expect(otherApp).not.toHaveBeenCalled();
    expect(dataDeletionChannelName(SCOPE)).toContain(SCOPE);
  });

  it('ignores unrelated messages; stop closes the channel', async () => {
    const onDeleted = vi.fn();
    const stop = watchDataDeletion(onDeleted, factory, SCOPE);
    const sender = new BroadcastChannel(dataDeletionChannelName(SCOPE));
    sender.postMessage('something-else');
    await nextTick();
    expect(onDeleted).not.toHaveBeenCalled();
    stop();
    sender.postMessage(DATA_DELETED_MESSAGE);
    await nextTick();
    expect(onDeleted).not.toHaveBeenCalled();
    sender.close();
  });

  it('without BroadcastChannel support nothing fails', () => {
    expect(() => announceDataDeleted(undefined, SCOPE)).not.toThrow();
    expect(watchDataDeletion(vi.fn(), undefined, SCOPE)).toBeTypeOf('function');
  });
});
