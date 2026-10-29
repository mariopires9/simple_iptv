// What the first bytes of a stream response say (PLY-06): an HLS playlist (and whether it points
// at insecure http:// URIs or declares HEVC), an MPEG-TS stream (and whether its program map
// declares HEVC), another media container, or text (an HTML error page, JSON…). Pure functions
// over bytes the probe read; nothing here is logged. The only URI kept from a playlist is the
// first variant of a master playlist, which the probe requests next and never returns.

/** Bytes of one MPEG-TS packet. */
const TS_PACKET = 188;
const TS_SYNC = 0x47;
/** PMT `stream_type` of HEVC video (ISO/IEC 13818-1, Table 2-34). */
const STREAM_TYPE_HEVC = 0x24;
/** Maximum playlist lines inspected. */
const MAX_PLAYLIST_LINES = 500;

export type SniffedContent =
  | {
      type: 'playlist';
      /** URIs (segments, variants, keys, media) resolving to `http:`: blocked on an https page. */
      httpUris: number;
      /** A `CODECS` attribute lists HEVC (`hvc1`/`hev1`). */
      hevc: boolean;
      /** Master playlist: its first variant, resolved (in memory only; contains credentials). */
      variant?: string;
    }
  | { type: 'ts'; hevc: boolean }
  /** Another media container (MP4/MOV, Matroska/WebM, FLV, AVI): no detail is inspected. */
  | { type: 'media' }
  /** Text that is not a playlist (HTML error page, JSON, plain text). */
  | { type: 'text' }
  | { type: 'empty' }
  /** Unknown binary data. */
  | { type: 'other' };

const URI_ATTRIBUTE = /URI\s*=\s*"([^"]*)"/gi;
const CODECS_ATTRIBUTE = /CODECS\s*=\s*"([^"]*)"/i;
const HEVC_CODEC = /(^|[\s,])(hvc1|hev1)(\.|[\s,]|$)/i;

function resolvesToHttp(uri: string, base: string | undefined): boolean {
  const trimmed = uri.trim();
  if (trimmed === '') return false;
  try {
    return new URL(trimmed, base).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Inspects the start of an HLS playlist (`#EXTM3U`). `baseUrl` is the address it was finally
 * served from (relative URIs resolve against it).
 */
export function sniffPlaylist(text: string, baseUrl: string | undefined): SniffedContent {
  let httpCount = 0;
  let hevc = false;
  let master = false;
  let variant: string | undefined;
  const lines = text.split(/\r?\n/, MAX_PLAYLIST_LINES);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) master = true;
    if (line.startsWith('#')) {
      const codecs = CODECS_ATTRIBUTE.exec(line)?.[1];
      if (codecs !== undefined && HEVC_CODEC.test(codecs)) hevc = true;
      for (const match of line.matchAll(URI_ATTRIBUTE)) {
        if (match[1] !== undefined && resolvesToHttp(match[1], baseUrl)) httpCount += 1;
      }
      continue;
    }
    if (resolvesToHttp(line, baseUrl)) httpCount += 1;
    if (master && variant === undefined) {
      try {
        variant = new URL(line, baseUrl).href;
      } catch {
        // Not a URI: ignored.
      }
    }
  }
  return { type: 'playlist', httpUris: httpCount, hevc, ...(variant ? { variant } : {}) };
}

/** Section bytes of a PSI packet payload (after the pointer field), or undefined. */
function psiSection(packet: Uint8Array): Uint8Array | undefined {
  const b1 = packet[1] ?? 0;
  const b3 = packet[3] ?? 0;
  if ((b1 & 0x40) === 0) return undefined; // not the start of a section
  const adaptation = (b3 >> 4) & 0x3;
  if ((adaptation & 0x1) === 0) return undefined; // no payload
  let offset = 4;
  if (adaptation & 0x2) offset += 1 + (packet[4] ?? 0);
  const pointer = packet[offset];
  if (pointer === undefined) return undefined;
  const start = offset + 1 + pointer;
  return start < packet.length ? packet.subarray(start) : undefined;
}

function pidOf(packet: Uint8Array): number {
  return (((packet[1] ?? 0) & 0x1f) << 8) | (packet[2] ?? 0);
}

function sectionLength(section: Uint8Array): number {
  return (((section[1] ?? 0) & 0x0f) << 8) | (section[2] ?? 0);
}

/** PMT PIDs listed in a PAT section. */
function patProgramMapPids(section: Uint8Array): number[] {
  if (section[0] !== 0x00) return [];
  const end = Math.min(3 + sectionLength(section) - 4, section.length);
  const pids: number[] = [];
  for (let i = 8; i + 4 <= end; i += 4) {
    const program = ((section[i] ?? 0) << 8) | (section[i + 1] ?? 0);
    if (program === 0) continue; // network PID
    pids.push((((section[i + 2] ?? 0) & 0x1f) << 8) | (section[i + 3] ?? 0));
  }
  return pids;
}

/** Elementary `stream_type`s listed in a PMT section. */
function pmtStreamTypes(section: Uint8Array): number[] {
  if (section[0] !== 0x02) return [];
  const end = Math.min(3 + sectionLength(section) - 4, section.length);
  const programInfo = (((section[10] ?? 0) & 0x0f) << 8) | (section[11] ?? 0);
  const types: number[] = [];
  for (let i = 12 + programInfo; i + 5 <= end;) {
    types.push(section[i] ?? 0);
    const esInfo = (((section[i + 3] ?? 0) & 0x0f) << 8) | (section[i + 4] ?? 0);
    i += 5 + esInfo;
  }
  return types;
}

/** Whether `bytes` start like an MPEG-TS stream (sync byte every 188 bytes). */
export function looksLikeTs(bytes: Uint8Array): boolean {
  if (bytes[0] !== TS_SYNC) return false;
  return bytes.length < TS_PACKET * 2 || bytes[TS_PACKET] === TS_SYNC;
}

/**
 * MPEG-TS: reads the PAT and the PMT(s) found in the first packets and reports whether a video
 * stream is HEVC (Safari's native HLS cannot play HEVC in MPEG-TS; mpegts.js cannot demux it).
 */
export function sniffTs(bytes: Uint8Array): SniffedContent {
  const pmtPids = new Set<number>();
  let hevc = false;
  for (let offset = 0; offset + TS_PACKET <= bytes.length; offset += TS_PACKET) {
    const packet = bytes.subarray(offset, offset + TS_PACKET);
    if (packet[0] !== TS_SYNC) break;
    const pid = pidOf(packet);
    if (pid !== 0 && !pmtPids.has(pid)) continue;
    const section = psiSection(packet);
    if (!section) continue;
    if (pid === 0) {
      for (const pmt of patProgramMapPids(section)) pmtPids.add(pmt);
    } else if (pmtStreamTypes(section).includes(STREAM_TYPE_HEVC)) {
      hevc = true;
      break;
    }
  }
  return { type: 'ts', hevc };
}

const UTF8_BOM = '\uFEFF';

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** MP4/MOV (`ftyp`), Matroska/WebM (EBML), FLV, AVI (`RIFF…AVI `). */
function isOtherMedia(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 8) === 'ftyp') return true;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (ascii(bytes, 0, 3) === 'FLV') return true;
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'AVI ';
}

/** Classifies the first bytes of a response. `baseUrl`: where it was finally served from. */
export function sniffContent(bytes: Uint8Array, baseUrl: string | undefined): SniffedContent {
  if (bytes.length === 0) return { type: 'empty' };
  if (looksLikeTs(bytes)) return sniffTs(bytes);
  if (isOtherMedia(bytes)) return { type: 'media' };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const start = text.replace(UTF8_BOM, '').trimStart();
  if (start.startsWith('#EXTM3U')) return sniffPlaylist(start, baseUrl);
  return /^[<{[]/.test(start) ? { type: 'text' } : { type: 'other' };
}
