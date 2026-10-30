// Live stream test of the diagnostics (PLY-06 C): the first live channel of the list, its
// address built in memory (Xtream: TS and HLS, like the player plans them) and probed once each,
// one after the other (Xtream accounts are often limited to one connection). The addresses embed
// the credentials: they are never stored, logged or returned — results carry the masked form.
import { catalogRepo, type Channel, type Source } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import { containerOfExtension, declaredContainer, type EngineChoice } from '@/player';
import { probeFinding, type StreamProbeResult } from '@/player/probe';
import { xtreamLiveStreamUrl, xtreamStreamId } from '@/providers/xtream';
import {
  liveFormatSupport,
  type LiveStreamOutcome,
  type LiveStreamProbe,
  type PlaybackCaps,
} from './checks';

/** At most this many live categories are looked at to find a channel. */
const MAX_CATEGORIES = 20;

export interface LiveStreamTestDeps {
  firstLiveChannel: (sourceId: string) => Promise<Channel | undefined>;
  readPassword: (sourceId: string) => Promise<string | undefined>;
  probe: (url: string, signal: AbortSignal | undefined) => Promise<StreamProbeResult>;
}

/** The first channel of the first non-empty live category (in the list's own order). */
export async function firstLiveChannel(sourceId: string): Promise<Channel | undefined> {
  const categories = await catalogRepo.listCategories(sourceId, 'live');
  for (const category of categories.slice(0, MAX_CATEGORIES)) {
    const [channel] = await catalogRepo.listByCategory('live', category.key, { limit: 1 });
    if (channel) return channel;
  }
  return undefined;
}

interface Target {
  format: 'ts' | 'm3u8';
  engine: EngineChoice;
  url: string;
}

/** M3U entry: its own address and container (DRM/DASH entries are never requested). */
function m3uTarget(channel: Channel, caps: PlaybackCaps): Target | undefined {
  const fields = channel as Channel & { streamUrl?: unknown; container?: unknown; drm?: unknown };
  if (fields.drm !== undefined && fields.drm !== null && fields.drm !== false) return undefined;
  const raw = typeof fields.streamUrl === 'string' ? fields.streamUrl : channel.streamPath;
  const parsed = parseExternalUrl(raw, 'stream');
  if (!parsed.ok) return undefined;
  const container =
    declaredContainer(fields.container) ??
    containerOfExtension(/\.([a-z0-9]{2,6})$/i.exec(parsed.url.pathname)?.[1]) ??
    'ts';
  if (container === 'dash') return undefined;
  const support = liveFormatSupport(caps);
  return container === 'hls'
    ? { format: 'm3u8', engine: support.hls, url: parsed.url.href }
    : { format: 'ts', engine: support.ts, url: parsed.url.href };
}

export async function runLiveStreamTest(
  source: Source,
  caps: PlaybackCaps,
  deps: LiveStreamTestDeps,
  signal: AbortSignal | undefined,
): Promise<LiveStreamOutcome> {
  const channel = await deps.firstLiveChannel(source.id);
  if (!channel) return { outcome: 'no-channels' };

  let targets: Target[];
  if (source.kind === 'xtream') {
    const { serverUrl, username } = source;
    const streamId = xtreamStreamId(channel.streamPath);
    if (!serverUrl || !username || streamId === '') {
      return { outcome: 'unavailable' };
    }
    let password: string | undefined;
    try {
      password = await deps.readPassword(source.id);
    } catch {
      password = undefined;
    }
    if (password === undefined) return { outcome: 'no-secret' };
    const secret = password;
    const support = liveFormatSupport(caps);
    const url = (ext: 'ts' | 'm3u8') =>
      xtreamLiveStreamUrl(serverUrl, username, secret, streamId, ext);
    targets = [
      { format: 'ts', engine: support.ts, url: url('ts') },
      { format: 'm3u8', engine: support.hls, url: url('m3u8') },
    ];
  } else {
    const target = m3uTarget(channel, caps);
    if (!target) return { outcome: 'unavailable' };
    targets = [target];
  }

  const probes: LiveStreamProbe[] = [];
  for (const target of targets) {
    if (signal?.aborted === true) break;
    const result = await deps.probe(target.url, signal);
    probes.push({
      format: target.format,
      engine: target.engine,
      result,
      finding: probeFinding(result, target.engine),
    });
  }
  return { outcome: 'probed', probes };
}
