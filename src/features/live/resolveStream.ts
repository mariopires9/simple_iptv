// Channel → playable stream (LIV-02, docs/ARCHITECTURE.md §5–§6.2).
//
// - Xtream: only the stream id is stored; the URL embeds the credentials, so it is built here, in
//   memory, at play time: `${server}/live/${user}/${pass}/${id}.${ext}`. The password comes from
//   the vault (which registers it with the log redactor). The URL is never logged.
// - M3U: the entry's own URL (`streamUrl`, falling back to `streamPath`) with its `container`
//   (or the one inferred from the extension). Entries flagged `drm` or DASH are never attempted
//   (PLY-04 AC7, no DRM circumvention — SECURITY.md §8).
import type { Channel, LiveFormat, Source } from '@/core/db';
import { VaultKeyLostError, credentialVault, type CredentialVault } from '@/core/crypto';
import { parseExternalUrl } from '@/core/net';
import { getCapabilities, type Capabilities } from '@/core/platform';
import {
  NATIVE_AUDIO_CONTAINER,
  containerOfExtension,
  declaredContainer,
  type ContainerOrDash,
  type StreamContainer,
  type StreamDescriptor,
} from '@/player';
import { xtreamLiveStreamUrl, xtreamStreamId } from '@/providers/xtream';

/**
 * Fields an M3U entry may carry (SRC-04, written by the M3U provider). Read defensively: older
 * catalogues and Xtream channels do not have them.
 */
export interface M3uChannelFields {
  streamUrl?: unknown;
  container?: unknown;
  drm?: unknown;
  requiredHeaders?: unknown;
  audioOnly?: unknown;
}

export type ResolvedStream =
  | {
      status: 'ok';
      descriptor: StreamDescriptor;
      /** The entry declares headers (Referer/User-Agent…) a browser cannot send. */
      requiredHeaders: boolean;
    }
  /** DRM-protected or DASH entry: never attempted. */
  | { status: 'unsupported'; reason: 'drm' | 'dash' }
  /** The Xtream password is missing or can no longer be decrypted (`VaultKeyLostError`). */
  | { status: 'credentials' }
  /** No usable stream address (corrupt entry, incomplete source). */
  | { status: 'unavailable' };

export interface ResolveDeps {
  vault?: Pick<CredentialVault, 'get'>;
  capabilities?: Pick<Capabilities, 'mse' | 'mms'>;
}

let cachedCapabilities: Pick<Capabilities, 'mse' | 'mms'> | undefined;
function defaultCapabilities(): Pick<Capabilities, 'mse' | 'mms'> {
  cachedCapabilities ??= getCapabilities();
  return cachedCapabilities;
}

export interface InferredContainer {
  container: ContainerOrDash;
  /** No (recognised) extension: a best guess, so the other live engine is a fallback. */
  guessed: boolean;
}

/**
 * Container from the URL path's extension. Live URLs without a recognised one
 * (`http://host/123`, `…/play.php`) are most often raw MPEG-TS (the Xtream short form), so that is
 * the guess — with HLS as the fallback. Radio entries (`audioOnly`) are guessed as native audio.
 */
export function inferContainer(url: URL, audioOnly = false): InferredContainer {
  const match = /\.([a-z0-9]{2,6})$/i.exec(url.pathname);
  const known = containerOfExtension(match?.[1]);
  if (known !== undefined && !(audioOnly && known === 'ts')) {
    return { container: known, guessed: false };
  }
  return { container: audioOnly ? NATIVE_AUDIO_CONTAINER : 'ts', guessed: !audioOnly };
}

function hasHeaders(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return value !== false && value !== '';
}

function resolveM3u(channel: Channel): ResolvedStream {
  const fields = channel as Channel & M3uChannelFields;
  if (fields.drm !== undefined && fields.drm !== null && fields.drm !== false) {
    return { status: 'unsupported', reason: 'drm' };
  }
  const raw = typeof fields.streamUrl === 'string' ? fields.streamUrl : channel.streamPath;
  const parsed = parseExternalUrl(raw, 'stream');
  if (!parsed.ok) return { status: 'unavailable' };
  const declared = declaredContainer(fields.container);
  const { container, guessed } =
    declared !== undefined
      ? { container: declared, guessed: false }
      : inferContainer(parsed.url, fields.audioOnly === true);
  if (container === 'dash') return { status: 'unsupported', reason: 'dash' };
  const url = parsed.url.href;
  const descriptor: StreamDescriptor = { url, kind: 'live', container };
  if (guessed) {
    // Same URL, other live engine: mpegts.js ↔ hls.js, tried if the guess fails.
    const other: StreamContainer = container === 'hls' ? 'ts' : 'hls';
    descriptor.fallbacks = [{ url, kind: 'live', container: other }];
  }
  return {
    status: 'ok',
    descriptor,
    requiredHeaders: hasHeaders(fields.requiredHeaders),
  };
}

/** Xtream live descriptor for a format preference (exported for tests). */
export function xtreamLiveDescriptor(
  base: string,
  username: string,
  password: string,
  streamId: string,
  format: LiveFormat,
  caps: Pick<Capabilities, 'mse' | 'mms'>,
): StreamDescriptor {
  const url = (ext: 'ts' | 'm3u8') => xtreamLiveStreamUrl(base, username, password, streamId, ext);
  const ts: StreamDescriptor = { url: url('ts'), kind: 'live', container: 'ts' };
  const hls: StreamDescriptor = { url: url('m3u8'), kind: 'live', container: 'hls' };
  if (format === 'm3u8') return hls;
  if (format === 'ts' || caps.mse || caps.mms) return { ...ts, fallbacks: [hls] };
  return hls;
}

async function resolveXtream(
  channel: Channel,
  source: Source,
  deps: ResolveDeps,
): Promise<ResolvedStream> {
  const { serverUrl, username, secretRef } = source;
  // Stored as the bare id; tolerate an extension left by an older catalogue.
  const streamId = xtreamStreamId(channel.streamPath);
  if (!serverUrl || !username || streamId === '') {
    return secretRef ? { status: 'unavailable' } : { status: 'credentials' };
  }
  if (!secretRef) return { status: 'credentials' };
  let password: string | undefined;
  try {
    password = await (deps.vault ?? credentialVault).get(secretRef);
  } catch (error) {
    if (error instanceof VaultKeyLostError) return { status: 'credentials' };
    throw error;
  }
  if (password === undefined) return { status: 'credentials' };
  const descriptor = xtreamLiveDescriptor(
    serverUrl,
    username,
    password,
    streamId,
    source.prefs.liveFormat,
    // Only "auto" depends on the browser; probing creates a <video>, so skip it otherwise.
    source.prefs.liveFormat === 'auto'
      ? (deps.capabilities ?? defaultCapabilities())
      : { mse: false, mms: false },
  );
  // PLY-08: VLC is handed the `.ts` stream, whatever is played here.
  descriptor.externalUrl = xtreamLiveStreamUrl(serverUrl, username, password, streamId, 'ts');
  // PLY-08: VLC is handed the `.ts` stream, whatever is played here.
  descriptor.externalUrl = xtreamLiveStreamUrl(serverUrl, username, password, streamId, 'ts');
  return { status: 'ok', descriptor, requiredHeaders: false };
}

/** Builds the stream of a live channel of `source`. Never logs the URL. */
export async function resolveStream(
  channel: Channel,
  source: Source,
  deps: ResolveDeps = {},
): Promise<ResolvedStream> {
  return source.kind === 'xtream' ? resolveXtream(channel, source, deps) : resolveM3u(channel);
}
