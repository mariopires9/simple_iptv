// PLY-07 — Live learns the container that actually started per channel (and device class), only
// for channels that have an alternative. PlayerView is mocked (its props are captured).
import 'fake-indexeddb/auto';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll, type Channel, type Source } from '@/core/db';
import { learnedFormat, resetLearnedFormatsForTests } from '@/core/session/liveFormatMemory';
import type { StreamDescriptor } from '@/player';
import type { PlayerViewProps } from '@/player/ui';
import { LivePlayer } from './LivePlayer';
import { liveDeviceClass, resolveStream } from './resolveStream';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div data-testid="mock-player" />;
  },
}));
vi.mock('./resolveStream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolveStream')>();
  return { ...actual, resolveStream: vi.fn() };
});

afterEach(async () => {
  views.length = 0;
  resetLearnedFormatsForTests();
  await wipeAll();
});

const source: Source = {
  id: 's1',
  kind: 'm3u-url',
  name: 'List',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 1, movies: 0, series: 0 },
};
const channel = { key: 's1:live:7', name: 'Channel 7', streamPath: 'x' } as Channel;
const TS: StreamDescriptor = { url: 'http://h/live/u/p/7.ts', kind: 'live', container: 'ts' };
const HLS: StreamDescriptor = { url: 'http://h/live/u/p/7.m3u8', kind: 'live', container: 'hls' };

async function play(descriptor: StreamDescriptor) {
  vi.mocked(resolveStream).mockResolvedValue({ status: 'ok', descriptor, requiredHeaders: false });
  render(
    <LivePlayer
      source={source}
      selection={{ channel, via: 'pick' }}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onToggleChannelList={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(views.at(-1)?.onStarted).toBeDefined());
  return views.at(-1)!;
}

describe('LivePlayer — learning the live format (PLY-07)', () => {
  it('the fallback that started is remembered for the channel', async () => {
    const view = await play({ ...TS, fallbacks: [HLS] });
    act(() => view.onStarted?.(HLS));
    expect(learnedFormat(channel.key, liveDeviceClass())).toBe('hls');
  });

  it('a channel without an alternative is not remembered', async () => {
    const view = await play(HLS);
    act(() => view.onStarted?.(HLS));
    expect(learnedFormat(channel.key, liveDeviceClass())).toBeUndefined();
  });
});
