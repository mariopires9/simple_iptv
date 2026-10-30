// Channel → playable stream (LIV-02, docs/ARCHITECTURE.md §5–§6.2).
//
// - Xtream: only the stream id is stored; the URL embeds the credentials, so it is built here, in
//   memory, at play time: `${server}/live/${user}/${pass}/${id}.${ext}`. The password comes from
//   the vault (which registers it with the log redactor). The URL is never logged.
// - M3U: the entry's own URL (`streamUrl`, falling back to `streamPath`) with its `container`
//   (or the one inferred from the extension). Entries flagged `drm` or DASH are never attempted
//   (PLY-04 AC7, no DRM circumvention — SECURITY.md §8).
//
// Live candidate order (PLY-07, docs/ARCHITECTURE.md §6.2), first match wins:
// 1. the container this channel last actually started with (learned per channel, in memory);
// 2. the list's explicit format preference (Xtream `ts` / `m3u8`), or the M3U URL's extension;
// 3. `auto`: on native-HLS devices (iPhone: ManagedMediaSource without MSE; Safari) HLS first,
//    played natively, with TS as the fallback; elsewhere MPEG-TS when the browser has
//    MSE/ManagedMediaSource, else HLS. (On iPhone, mpegts.js over ManagedMediaSource showed green
//    frames and stalls; native HLS is the platform's own path.)
// The memory is kept per device class (`liveDeviceClass`): a format learned on one class never
// reorders another.
// The other live container always stays as a fallback when one can be built without inventing
// an address: Xtream (both URLs are known), M3U entries without an extension (same URL, other
// engine) and M3U entries on an Xtream-style live path (same URL, `.ts` ↔ `.m3u8`).
import type { Channel, LiveFormat, Source } from '@/core/db';
import { VaultKeyLostError, credentialVault, type CredentialVault } from '@/core/crypto';
import { parseExternalUrl } from '@/core/net';
import { getCapabilities, type Capabilities } from '@/core/platform';
import {
  learnedFormat,
  type LearnedContainer,
  type LiveDeviceClass,
} from '@/core/session/liveFormatMemory';
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
  capabilities?: LiveCapabilities;
  /** PLY-07: the learned container of a channel (default: the in-memory memory). */
  learned?: (channelKey: string, deviceClass: LiveDeviceClass) => LearnedContainer | undefined;
}

/** What live format selection reads (`nativeHls`/`isSafari` absent = false). */
export type LiveCapabilities = Pick<Capabilities, 'mse' | 'mms'> &
  Partial<Pick<Capabilities, 'nativeHls' | 'isSafari'>>;

let cachedCapabilities: LiveCapabilities | undefined;
function defaultCapabilities(): LiveCapabilities {
  cachedCapabilities ??= getCapabilities();
  return cachedCapabilities;
}

/**
 * PLY-07: `native-hls` where HLS is best played by the browser itself — iPhone (ManagedMediaSource
 * but no MSE) and Safari — else `mse`. Recent Chrome also reports native HLS but keeps `mse`.
 */
export function liveDeviceClass(caps: LiveCapabilities = defaultCapabilities()): LiveDeviceClass {
  return (caps.isSafari === true && caps.nativeHls === true) || (!caps.mse && caps.mms)
    ? 'native-hls'
    : 'mse';
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

/**
 * Xtream-style live path: `/live/<user>/<pass>/<id>.<ext>` or the short `/<user>/<pass>/<id>.<ext>`
 * (numeric id). Such servers serve the same channel as `.ts` and `.m3u8`.
 */
const XTREAM_STYLE_LIVE_PATH = /^(?:\/live)?\/[^/]+\/[^/]+\/\d+\.(ts|m3u8)$/i;

/** The same URL with the other live extension, for an Xtream-style live path; else undefined. */
export function xtreamStyleAlternative(
  url: URL,
  container: StreamContainer,
): StreamDescriptor | undefined {
  const match = XTREAM_STYLE_LIVE_PATH.exec(url.pathname);
  const ext = match?.[1]?.toLowerCase();
  if (!((ext === 'ts' && container === 'ts') || (ext === 'm3u8' && container === 'hls'))) {
    return undefined;
  }
  const other = new URL(url.href);
  other.pathname = url.pathname.replace(/\.(ts|m3u8)$/i, ext === 'ts' ? '.m3u8' : '.ts');
  return { url: other.href, kind: 'live', container: ext === 'ts' ? 'hls' : 'ts' };
}

/**
 * Puts the candidate with the `preferred` container first (PLY-07); the others keep their order
 * as fallbacks. Unchanged when there is no such candidate or it is already first.
 */
export function preferContainer(
  descriptor: StreamDescriptor,
  preferred: LearnedContainer | undefined,
): StreamDescriptor {
  const { fallbacks = [], ...first } = descriptor;
  const index = fallbacks.findIndex((d) => d.container === preferred);
  const chosen = fallbacks[index];
  if (preferred === undefined || first.container === preferred || !chosen) return descriptor;
  const rest = [first, ...fallbacks.filter((_, i) => i !== index)];
  return { ...chosen, fallbacks: rest };
}

function resolveM3u(channel: Channel, caps: () => LiveCapabilities): ResolvedStream {
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
    // A guess is "auto": native-HLS devices try HLS first (see the header).
    if (liveDeviceClass(caps()) === 'native-hls') {
      return {
        status: 'ok',
        descriptor: preferContainer(descriptor, 'hls'),
        requiredHeaders: hasHeaders(fields.requiredHeaders),
      };
    }
  } else {
    // PLY-07: only on an Xtream-style path; other URLs get no invented address.
    const alternative = xtreamStyleAlternative(parsed.url, container);
    if (alternative) descriptor.fallbacks = [alternative];
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
  caps: LiveCapabilities,
): StreamDescriptor {
  const url = (ext: 'ts' | 'm3u8') => xtreamLiveStreamUrl(base, username, password, streamId, ext);
  const ts: StreamDescriptor = { url: url('ts'), kind: 'live', container: 'ts' };
  const hls: StreamDescriptor = { url: url('m3u8'), kind: 'live', container: 'hls' };
  const mediaSource = caps.mse || caps.mms;
  // PLY-07: HLS first, with TS as the fallback when this browser can play it (mpegts.js).
  const hlsFirst = mediaSource ? { ...hls, fallbacks: [ts] } : hls;
  if (format === 'm3u8') return hlsFirst;
  if (format === 'ts') return { ...ts, fallbacks: [hls] };
  // auto
  if (liveDeviceClass(caps) === 'native-hls') return hlsFirst;
  return mediaSource ? { ...ts, fallbacks: [hls] } : hls;
}

async function resolveXtream(
  channel: Channel,
  source: Source,
  deps: ResolveDeps,
  caps: () => LiveCapabilities,
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
    caps(),
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
  // Probed on first need (it creates a <video>), then cached for the session.
  const caps = () => deps.capabilities ?? defaultCapabilities();
  const resolved =
    source.kind === 'xtream'
      ? await resolveXtream(channel, source, deps, caps)
      : resolveM3u(channel, caps);
  if (resolved.status !== 'ok' || !resolved.descriptor.fallbacks?.length) return resolved;
  // PLY-07: the learned container (on this device class) beats the list's preference.
  const learned = (deps.learned ?? learnedFormat)(channel.key, liveDeviceClass(caps()));
  return { ...resolved, descriptor: preferContainer(resolved.descriptor, learned) };
}
