// Movie → playable VOD stream (VOD-02 AC3, docs/ARCHITECTURE.md §5–§6.2).
//
// - Xtream: only `id.ext` is stored (`streamPath`); the URL embeds the credentials, so it is built
//   here, in memory, at play time: `${server}/movie/${user}/${pass}/${id}.${ext}`. The password
//   comes from the vault (which registers it with the log redactor). The URL is never logged.
// - M3U: the entry's own URL (`streamUrl`) with its declared or inferred container. Entries
//   flagged `drm` or DASH are never attempted (no DRM circumvention — SECURITY.md §8).
import { VaultKeyLostError, credentialVault, type CredentialVault } from '@/core/crypto';
import type { Movie, Source } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import type { StreamContainer, StreamDescriptor } from '@/player';
import { xtreamStreamId } from './movieInfo';

export type ResolvedMovie =
  | { status: 'ok'; descriptor: StreamDescriptor }
  /** DRM-protected or DASH entry: never attempted. */
  | { status: 'unsupported'; reason: 'drm' | 'dash' }
  /** The Xtream password is missing or can no longer be decrypted (`VaultKeyLostError`). */
  | { status: 'credentials' }
  /** No usable stream address (corrupt entry, incomplete source). */
  | { status: 'unavailable' };

export interface ResolveMovieDeps {
  vault?: Pick<CredentialVault, 'get'>;
  /** Container extension from `get_vod_info`, used when the catalogue has none. */
  infoExt?: string | undefined;
}

/** Default Xtream VOD extension when neither the catalogue nor the details give one. */
export const DEFAULT_VOD_EXT = 'mp4';

const EXTENSION_CONTAINERS: Readonly<Record<string, StreamContainer | 'dash'>> = {
  m3u8: 'hls',
  m3u: 'hls',
  ts: 'ts',
  mp4: 'mp4',
  m4v: 'mp4',
  mkv: 'mkv',
  webm: 'webm',
  mov: 'mov',
  flv: 'flv',
  avi: 'avi',
  mpd: 'dash',
  // Container names an M3U entry may declare (`Movie.container`).
  hls: 'hls',
  dash: 'dash',
  // Audio files play in the browser's own element (the native engine, as `mp4`).
  mp3: 'mp4',
  aac: 'mp4',
  m4a: 'mp4',
  ogg: 'mp4',
  flac: 'mp4',
};

/** Container of an extension (`mkv`, `.MP4`…), `dash`, or `unknown`. */
export function containerOf(ext: string | undefined): StreamContainer | 'dash' {
  if (ext === undefined) return 'unknown';
  return EXTENSION_CONTAINERS[ext.toLowerCase().replace(/^\./, '')] ?? 'unknown';
}

function extensionOf(path: string): string | undefined {
  return /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase();
}

/**
 * Whether resolving this movie depends on `get_vod_info`: an Xtream movie whose catalogue entry
 * has no container extension (the details' `container_extension` is then the best source).
 */
export function needsInfoExt(movie: Movie, source: Source): boolean {
  return source.kind === 'xtream' && extensionOf(movie.streamPath) === undefined && !movie.ext;
}

/** Xtream VOD URL (exported for tests). Never log the result: it contains the password. */
export function xtreamMovieUrl(
  base: string,
  username: string,
  password: string,
  streamId: string,
  ext: string,
): string {
  return `${base.replace(/\/+$/, '')}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${encodeURIComponent(ext)}`;
}

async function resolveXtream(
  movie: Movie,
  source: Source,
  deps: ResolveMovieDeps,
): Promise<ResolvedMovie> {
  const { serverUrl, username, secretRef } = source;
  const streamId = xtreamStreamId(movie);
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
  const ext = extensionOf(movie.streamPath) ?? movie.ext ?? deps.infoExt ?? DEFAULT_VOD_EXT;
  const container = containerOf(ext);
  if (container === 'dash') return { status: 'unsupported', reason: 'dash' };
  return {
    status: 'ok',
    descriptor: {
      url: xtreamMovieUrl(serverUrl, username, password, streamId, ext),
      kind: 'vod',
      container,
    },
  };
}

function resolveM3u(movie: Movie): ResolvedMovie {
  if (movie.drm === true) return { status: 'unsupported', reason: 'drm' };
  const raw = movie.streamUrl ?? movie.streamPath;
  const parsed = parseExternalUrl(raw, 'stream');
  if (!parsed.ok) return { status: 'unavailable' };
  const declared = containerOf(movie.container);
  const container =
    declared !== 'unknown' ? declared : containerOf(extensionOf(parsed.url.pathname));
  if (container === 'dash') return { status: 'unsupported', reason: 'dash' };
  return { status: 'ok', descriptor: { url: parsed.url.href, kind: 'vod', container } };
}

/** Builds the VOD stream of `movie` of `source`. Never logs the URL. */
export function resolveMovieStream(
  movie: Movie,
  source: Source,
  deps: ResolveMovieDeps = {},
): Promise<ResolvedMovie> {
  return source.kind === 'xtream'
    ? resolveXtream(movie, source, deps)
    : Promise.resolve(resolveM3u(movie));
}
