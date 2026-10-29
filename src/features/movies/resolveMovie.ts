// Movie → playable VOD stream (VOD-02 AC3, docs/ARCHITECTURE.md §5–§6.2), through the shared VOD
// resolver (`@/ui/vod/resolveVod`): Xtream URLs are built in memory with the vault's password
// (`${server}/movie/${user}/${pass}/${id}.${ext}`), M3U entries play their own URL; DRM/DASH are
// never attempted. The URL is never logged.
import type { CredentialVault } from '@/core/crypto';
import type { Movie, Source } from '@/core/db';
import {
  DEFAULT_VOD_EXT,
  containerOf,
  extensionOf,
  resolveM3uVod,
  resolveXtreamVod,
  xtreamVodUrl,
  type ResolvedVod,
} from '@/ui/vod/resolveVod';
import { xtreamStreamId } from './movieInfo';

export { DEFAULT_VOD_EXT, containerOf };
export type ResolvedMovie = ResolvedVod;

export interface ResolveMovieDeps {
  vault?: Pick<CredentialVault, 'get'>;
  /** Container extension from `get_vod_info`, used when the catalogue has none. */
  infoExt?: string | undefined;
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
  return xtreamVodUrl('movie', base, username, password, streamId, ext);
}

/** Builds the VOD stream of `movie` of `source`. Never logs the URL. */
export function resolveMovieStream(
  movie: Movie,
  source: Source,
  deps: ResolveMovieDeps = {},
): Promise<ResolvedMovie> {
  if (source.kind !== 'xtream') return Promise.resolve(resolveM3uVod(movie));
  const ext = extensionOf(movie.streamPath) ?? movie.ext ?? deps.infoExt ?? DEFAULT_VOD_EXT;
  return resolveXtreamVod('movie', source, xtreamStreamId(movie), ext, deps);
}
