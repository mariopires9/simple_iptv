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

/** C0/C1 control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const CONTROLS = new RegExp(CONTROL.source, 'g');

/**
 * Base64 → UTF-8 text, for fields the panel sends base64-encoded (`get_short_epg` titles and
 * descriptions). A value that is not base64, whose bytes are not valid UTF-8, or that decodes to
 * control characters (e.g. `"AAAA"` → three NUL bytes: plain text that merely looks like
 * base64) is returned unchanged.
 */
export function decodeBase64Utf8(value: string): string {
  const compact = value.replace(/\s+/g, '');
  if (compact === '' || !BASE64.test(compact)) return value;
  try {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return CONTROL.test(text) ? value : text;
  } catch {
    return value;
  }
}

/** Strips control characters a title should never show. */
function clean(text: string): string {
  return text.replace(CONTROLS, '').trim();
}

/** How the panel encodes text fields: Xtream's short EPG sends them base64-encoded. */
export type ShortEpgEncoding = 'base64' | 'plain';

/** Upper bound on listings read from one response (a hostile panel could send millions). */
const MAX_LISTINGS = 50;

/**
 * Programmes of a `get_short_epg` response, sorted by start time. Anything that is not a listing
 * with a title and a valid `start_timestamp` < `stop_timestamp` is dropped; a body without
 * `epg_listings` yields `[]`.
 */
export function parseShortEpg(
  body: unknown,
  encoding: ShortEpgEncoding = 'base64',
): ShortEpgProgramme[] {
  const decode = encoding === 'base64' ? decodeBase64Utf8 : (text: string) => text;
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
    const decodedTitle = clean(decode(title));
    if (decodedTitle === '') continue;
    const programme: ShortEpgProgramme = { title: decodedTitle, start, end };
    const decodedDescription = description !== undefined ? clean(decode(description)) : '';
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
