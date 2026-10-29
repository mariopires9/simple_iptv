// Episode → playable VOD stream (SER-03), through the shared VOD resolver (`@/ui/vod/resolveVod`).
// - Xtream: `${server}/series/${user}/${pass}/${episodeId}.${ext}`, built in memory at play time
//   with the vault's password; never logged.
// - M3U: the entry's own URL (`streamUrl`), DRM/DASH never attempted.
import type { CredentialVault } from '@/core/crypto';
import type { Episode, Series, Source } from '@/core/db';
import {
  DEFAULT_VOD_EXT,
  extensionOf,
  resolveM3uVod,
  resolveXtreamVod,
  xtreamVodUrl,
  type ResolvedVod,
} from '@/ui/vod/resolveVod';

export interface ResolveEpisodeDeps {
  vault?: Pick<CredentialVault, 'get'>;
}

/** Xtream episode URL (exported for tests). Never log the result: it contains the password. */
export function xtreamEpisodeUrl(
  base: string,
  username: string,
  password: string,
  episodeId: string,
  ext: string,
): string {
  return xtreamVodUrl('series', base, username, password, episodeId, ext);
}

/** Builds the stream of `episode` of `series` of `source`. Never logs the URL. */
export function resolveEpisodeStream(
  source: Source,
  series: Series,
  episode: Episode,
  deps: ResolveEpisodeDeps = {},
): Promise<ResolvedVod> {
  // M3U (until VOD-04 groups series): the entry is the episode.
  if (source.kind !== 'xtream') return Promise.resolve(resolveM3uVod(series));
  const ext = episode.ext ?? extensionOf(episode.streamPath) ?? DEFAULT_VOD_EXT;
  return resolveXtreamVod('series', source, episode.externalId, ext, deps);
}
