// Xtream movie details (VOD-02 AC1): `get_vod_info`, cached in memory for 24 h per movie
// (docs/ARCHITECTURE.md §7). A small module-level cache instead of a query library: one entry per
// movie key, concurrent requests for the same movie share one fetch, failures are not cached.
//
// The request needs the account password: it is read from the vault (which registers it with
// the log redactor) and only lives in the client; neither it nor the URL is ever logged.
import { credentialVault, type CredentialVault } from '@/core/crypto';
import type { Movie, Source } from '@/core/db';
import type { FetchImpl } from '@/core/net';
import { createXtreamClient, fetchVodInfo, type VodInfo } from '@/providers/xtream';

export const INFO_TTL_MS = 24 * 60 * 60 * 1000;
/** Movies kept in the cache (the oldest fetch is dropped first). */
export const INFO_CACHE_SIZE = 200;

interface Entry {
  at: number;
  info: Promise<VodInfo>;
}

const cache = new Map<string, Entry>();

/** Forgets every cached details response (tests; wiping data). */
export function clearInfoCache(): void {
  cache.clear();
}

export interface InfoDeps {
  vault?: Pick<CredentialVault, 'get'>;
  fetchImpl?: FetchImpl;
  now?: () => number;
}

/** Thrown when the source cannot authenticate (no address, user or readable password). */
export class MissingCredentialsError extends Error {
  override readonly name = 'MissingCredentialsError';
}

/** Stream id of an Xtream movie: `streamPath` is `id.ext` (or the bare id). */
export function xtreamStreamId(movie: Pick<Movie, 'streamPath' | 'externalId'>): string {
  const id = movie.streamPath.replace(/\.[a-z0-9]{1,5}$/i, '');
  return id === '' ? movie.externalId : id;
}

async function fetchInfo(source: Source, movie: Movie, deps: InfoDeps): Promise<VodInfo> {
  const { serverUrl, username, secretRef } = source;
  if (!serverUrl || !username || !secretRef) throw new MissingCredentialsError();
  const password = await (deps.vault ?? credentialVault).get(secretRef);
  if (password === undefined) throw new MissingCredentialsError();
  const client = createXtreamClient({
    baseUrl: serverUrl,
    username,
    password,
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
  return fetchVodInfo(client, xtreamStreamId(movie));
}

/**
 * Details of an Xtream movie, from the cache when fetched less than 24 h ago. M3U sources have
 * no details endpoint: callers only use this for `source.kind === 'xtream'`.
 */
export function loadMovieInfo(source: Source, movie: Movie, deps: InfoDeps = {}): Promise<VodInfo> {
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(movie.key);
  if (hit && now - hit.at < INFO_TTL_MS) return hit.info;
  const info = fetchInfo(source, movie, deps);
  const entry: Entry = { at: now, info };
  cache.delete(movie.key);
  cache.set(movie.key, entry);
  while (cache.size > INFO_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  info.catch(() => {
    if (cache.get(movie.key) === entry) cache.delete(movie.key);
  });
  return info;
}
