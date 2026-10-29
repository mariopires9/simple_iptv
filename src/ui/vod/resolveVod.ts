// VOD item → playable stream (VOD-02 AC3, SER-03, docs/ARCHITECTURE.md §5–§6.2). Shared by the
// Movies and Series players since SER-03.
//
// - Xtream: only the stream id (+ extension) is stored; the URL embeds the credentials, so it is
//   built here, in memory, at play time: `${server}/${kind}/${user}/${pass}/${id}.${ext}` (`kind`
//   is `movie` or `series`). The password comes from the vault (which registers it with the log
//   redactor). The URL is never logged.
// - M3U: the entry's own URL (`streamUrl`) with its declared or inferred container. Entries
//   flagged `drm` or DASH are never attempted (no DRM circumvention — SECURITY.md §8).
import { VaultKeyLostError, credentialVault, type CredentialVault } from '@/core/crypto';
import type { Source, StreamContainer } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import { declaredContainer, type ContainerOrDash, type StreamDescriptor } from '@/player';

export type ResolvedVod =
  | { status: 'ok'; descriptor: StreamDescriptor }
  /** DRM-protected or DASH entry: never attempted. */
  | { status: 'unsupported'; reason: 'drm' | 'dash' }
  /** The Xtream password is missing or can no longer be decrypted (`VaultKeyLostError`). */
  | { status: 'credentials' }
  /** No usable stream address (corrupt entry, incomplete source). */
  | { status: 'unavailable' };

/** Default Xtream VOD extension when nothing gives one. */
export const DEFAULT_VOD_EXT = 'mp4';

export interface VaultDeps {
  vault?: Pick<CredentialVault, 'get'>;
}

/** Container of an extension (`mkv`, `.MP4`…), `dash`, or `unknown`. */
export function containerOf(ext: string | undefined): ContainerOrDash {
  return declaredContainer(ext?.trim().replace(/^\./, '')) ?? 'unknown';
}

/** Lower-case extension at the end of a path (`7.mkv` → `mkv`), if any. */
export function extensionOf(path: string): string | undefined {
  return /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase();
}

/** Xtream VOD URL (exported for tests). Never log the result: it contains the password. */
export function xtreamVodUrl(
  kind: 'movie' | 'series',
  base: string,
  username: string,
  password: string,
  streamId: string,
  ext: string,
): string {
  const enc = encodeURIComponent;
  return `${base.replace(/\/+$/, '')}/${kind}/${enc(username)}/${enc(password)}/${enc(streamId)}.${enc(ext)}`;
}

/** The Xtream stream of `streamId` with `ext`, reading the password from the vault. */
export async function resolveXtreamVod(
  kind: 'movie' | 'series',
  source: Source,
  streamId: string,
  ext: string,
  deps: VaultDeps = {},
): Promise<ResolvedVod> {
  const { serverUrl, username, secretRef } = source;
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
  const container = containerOf(ext);
  if (container === 'dash') return { status: 'unsupported', reason: 'dash' };
  return {
    status: 'ok',
    descriptor: {
      url: xtreamVodUrl(kind, serverUrl, username, password, streamId, ext),
      kind: 'vod',
      container,
    },
  };
}

/** The M3U fields a VOD entry is played from. */
export interface M3uVodEntry {
  streamUrl?: string | undefined;
  streamPath?: string | undefined;
  container?: StreamContainer | undefined;
  drm?: boolean | undefined;
}

/** The entry's own URL with its declared (else inferred) container. */
export function resolveM3uVod(entry: M3uVodEntry): ResolvedVod {
  if (entry.drm === true) return { status: 'unsupported', reason: 'drm' };
  const raw = entry.streamUrl ?? entry.streamPath ?? '';
  const parsed = parseExternalUrl(raw, 'stream');
  if (!parsed.ok) return { status: 'unavailable' };
  const declared = containerOf(entry.container);
  const container =
    declared !== 'unknown' ? declared : containerOf(extensionOf(parsed.url.pathname));
  if (container === 'dash') return { status: 'unsupported', reason: 'dash' };
  return { status: 'ok', descriptor: { url: parsed.url.href, kind: 'vod', container } };
}

/**
 * Identity of a source's account and data version, for caches of server answers (movie and
 * series details): editing a source (server, user, password reference) or syncing it changes it.
 */
export function sourceIdentity(source: Source): string {
  return [
    source.id,
    source.serverUrl ?? '',
    source.username ?? '',
    source.secretRef ?? '',
    source.lastSyncAt ?? 'never',
  ].join('\n');
}
