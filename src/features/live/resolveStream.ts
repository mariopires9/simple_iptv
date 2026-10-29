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
import type { StreamContainer, StreamDescriptor } from '@/player';

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

/**
 * Audio-only containers (radio). The player has no audio container kinds: the browser's own
 * element plays them, which is what the `mp4` container selects (native engine, no MSE).
 */
const NATIVE_AUDIO: StreamContainer = 'mp4';
const AUDIO_CONTAINERS = new Set(['mp3', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav']);

const EXTENSION_CONTAINERS: Readonly<Record<string, StreamContainer | 'dash'>> = {
  m3u8: 'hls',
  m3u: 'hls',
  ts: 'ts',
  mpegts: 'ts',
  mp4: 'mp4',
  m4v: 'mp4',
  mkv: 'mkv',
  webm: 'webm',
  mov: 'mov',
  flv: 'flv',
  avi: 'avi',
  mpd: 'dash',
  ...Object.fromEntries([...AUDIO_CONTAINERS].map((ext) => [ext, NATIVE_AUDIO])),
};

/**
 * `container` as declared by the entry — any player container, `dash`, or an audio container
 * (`mp3`, `aac`, `ogg`, `flac`… → native audio) — if recognisable.
 */
function declaredContainer(value: unknown): StreamContainer | 'dash' | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'hls' || v === 'dash') return v;
  return EXTENSION_CONTAINERS[v];
}

export interface InferredContainer {
  container: StreamContainer | 'dash';
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
  const known = match?.[1] !== undefined ? EXTENSION_CONTAINERS[match[1].toLowerCase()] : undefined;
  if (known !== undefined && !(audioOnly && known === 'ts')) {
    return { container: known, guessed: false };
  }
  return { container: audioOnly ? NATIVE_AUDIO : 'ts', guessed: !audioOnly };
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
  const prefix = `${base.replace(/\/+$/, '')}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}`;
  const ts: StreamDescriptor = { url: `${prefix}.ts`, kind: 'live', container: 'ts' };
  const hls: StreamDescriptor = { url: `${prefix}.m3u8`, kind: 'live', container: 'hls' };
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
  const streamId = channel.streamPath.replace(/\.[a-z0-9]{2,5}$/i, '');
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
