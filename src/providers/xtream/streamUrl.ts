// Xtream live stream address (LIV-02, PLY-06): `${server}/live/${user}/${pass}/${id}.${ext}`.
// It embeds the credentials: build it in memory at play/check time only, never store or log it
// (the log redactor masks the `/live/<user>/<pass>/` path anyway).

export type XtreamLiveExtension = 'ts' | 'm3u8';

export function xtreamLiveStreamUrl(
  serverUrl: string,
  username: string,
  password: string,
  streamId: string,
  extension: XtreamLiveExtension,
): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${extension}`;
}

/** Stream id of a stored channel (`streamPath`): tolerates an extension left by older catalogues. */
export function xtreamStreamId(streamPath: string): string {
  return streamPath.replace(/\.[a-z0-9]{2,5}$/i, '');
}
