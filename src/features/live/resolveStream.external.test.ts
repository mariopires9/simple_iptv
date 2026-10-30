// @vitest-environment node
// PLY-08 AC2: the address handed to VLC for an Xtream live channel is the direct `.ts` one, even
// when the app plays HLS.
import { describe, expect, it } from 'vitest';
import type { Channel, LiveFormat, Source } from '@/core/db';
import { externalStreamUrl } from '@/player/external';
import { resolveStream } from './resolveStream';

// Synthetic credentials only.
const SERVER = 'http://xtream.example:8080';
const BASE = `${SERVER}/live/demo/synthetic-pass/1001`;
const vault = { get: () => Promise.resolve('synthetic-pass') };

function source(liveFormat: LiveFormat): Source {
  return {
    id: 'x1',
    kind: 'xtream',
    name: 'Xtream',
    serverUrl: SERVER,
    username: 'demo',
    secretRef: 'xtream:x1',
    prefs: { liveFormat },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

const channel = {
  key: 'x1:live:1001',
  sourceId: 'x1',
  type: 'live',
  externalId: '1001',
  name: 'Channel',
  nameNorm: 'channel',
  order: 0,
  streamPath: '1001',
} as Channel;

describe('resolveStream — external player address (PLY-08)', () => {
  it.each(['m3u8', 'ts', 'auto'] as const)(
    'liveFormat %s hands off the .ts URL',
    async (format) => {
      const resolved = await resolveStream(channel, source(format), {
        vault,
        capabilities: { mse: false, mms: false },
      });
      expect(resolved.status).toBe('ok');
      if (resolved.status !== 'ok') return;
      expect(externalStreamUrl(resolved.descriptor)).toBe(`${BASE}.ts`);
    },
  );
});
