// Xtream short EPG (EPG-01, RESEARCH.md §7): `player_api.php?action=get_short_epg&stream_id&limit`.
//
// Panels send `epg_listings: [...]` with `title`/`description` in base64 (UTF-8 bytes) and the
// times twice: `start`/`end` as server-local wall-clock strings (time zone unknown) and
// `start_timestamp`/`stop_timestamp` as Unix seconds. Only the timestamps are used, so times can be
// shown in the device's time zone. The response is untrusted: every listing is validated on its
// own and an unusable one is dropped without failing the others.
import * as v from 'valibot';
import type { XtreamClient } from './client';
import { coerce, toEpochMs, toText } from './schemas';

export interface ShortEpgProgramme {
  title: string;
  description?: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms; always after `start`. */
  end: number;
}

const ListingSchema = v.object({
  title: coerce(toText),
  description: coerce(toText),
  start_timestamp: coerce(toEpochMs),
  stop_timestamp: coerce(toEpochMs),
});

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Base64 → UTF-8 text. Panels that send plain text (no base64, or bytes that are not valid
 * UTF-8) get their value back unchanged.
 */
export function decodeBase64Utf8(value: string): string {
  const compact = value.replace(/\s+/g, '');
  if (compact === '' || !BASE64.test(compact)) return value;
  try {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

/** Strips control characters (C0/C1 except whitespace) a decoded title should never show. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '').trim();
}

/** Upper bound on listings read from one response (a hostile panel could send millions). */
const MAX_LISTINGS = 50;

/**
 * Programmes of a `get_short_epg` response, sorted by start time. Anything that is not a listing
 * with a title and a valid `start_timestamp` < `stop_timestamp` is dropped; a body without
 * `epg_listings` yields `[]`.
 */
export function parseShortEpg(body: unknown): ShortEpgProgramme[] {
  if (typeof body !== 'object' || body === null) return [];
  const listings: unknown = Array.isArray(body)
    ? body
    : (body as { epg_listings?: unknown }).epg_listings;
  if (!Array.isArray(listings)) return [];
  const out: ShortEpgProgramme[] = [];
  for (const item of listings.slice(0, MAX_LISTINGS) as unknown[]) {
    const parsed = v.safeParse(ListingSchema, item);
    if (!parsed.success) continue;
    const { title, description, start_timestamp: start, stop_timestamp: end } = parsed.output;
    if (title === undefined || start === undefined || end === undefined || end <= start) continue;
    const decodedTitle = clean(decodeBase64Utf8(title));
    if (decodedTitle === '') continue;
    const programme: ShortEpgProgramme = { title: decodedTitle, start, end };
    const decodedDescription =
      description !== undefined ? clean(decodeBase64Utf8(description)) : '';
    if (decodedDescription !== '') programme.description = decodedDescription;
    out.push(programme);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Fetches and parses the short EPG of one live stream (`limit` programmes from now). */
export async function fetchShortEpg(
  client: Pick<XtreamClient, 'call'>,
  streamId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ShortEpgProgramme[]> {
  const body = await client.call('get_short_epg', { stream_id: streamId, limit }, signal);
  return parseShortEpg(body);
}
