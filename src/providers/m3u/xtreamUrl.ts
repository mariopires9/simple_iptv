// Recognises Xtream Codes playlist URLs (`…/get.php?username=…&password=…&type=m3u_plus`) so the UI
// can suggest the Xtream mode instead (SRC-05 AC2, RESEARCH.md §8): better metadata, and only the
// password is stored (encrypted) instead of thousands of URLs that embed it.
import { parseExternalUrl } from '@/core/net';

export interface XtreamPlaylistCredentials {
  /** Server base URL: origin plus any path before `get.php` (no trailing slash). */
  server: string;
  username: string;
  password: string;
}

/** Credentials of an Xtream `get.php` playlist URL, or `undefined` when it is not one. */
export function detectXtreamPlaylistUrl(input: string): XtreamPlaylistCredentials | undefined {
  const parsed = parseExternalUrl(input, 'source');
  if (!parsed.ok) return undefined;
  const { url } = parsed;
  const match = /^(.*)\/get\.php$/i.exec(url.pathname);
  if (!match) return undefined;
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password) return undefined;
  return { server: `${url.origin}${match[1] ?? ''}`, username, password };
}
