// Remote artwork URL check (channel logos LIV-01 AC3, posters and backdrops VOD-01 AC3). Shared
// since TEC-02.

/**
 * Whether the browser can load this image. `https:` and `data:image/…` always; `http:` only when
 * the page itself is not served over HTTPS (mixed content would be blocked or upgraded and fail).
 */
export function isLoadableImage(
  url: string | undefined,
  pageProtocol: string = globalThis.location?.protocol ?? 'https:',
): url is string {
  if (url === undefined || url.trim() === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  switch (parsed.protocol) {
    case 'https:':
      return true;
    case 'http:':
      return pageProtocol !== 'https:';
    case 'data:':
      return parsed.pathname.startsWith('image/');
    default:
      return false;
  }
}
