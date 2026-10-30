// Streaming (SAX-style) XMLTV parser — EPG-02 AC1/AC5. Runs inside the data worker.
//
// The document is never held in memory as a whole and never handed to DOMParser: text is fed in
// chunks (`write`) and only the parts XMLTV needs are kept — `<channel id>` with its
// `<display-name>`s and `<programme start stop channel>` with its first `<title>` and `<desc>`.
// Everything else (icons, credits, categories, ratings, comments, processing instructions, the
// DOCTYPE) is skipped as it streams by.
//
// Text: the five predefined XML entities and numeric character references are decoded; any other
// `&name;` (HTML entities are not XML) is kept literally. CDATA is taken verbatim. The result is
// plain text — it is rendered as a React text node, never as HTML (SEC-01). Control characters
// are replaced by spaces, whitespace is collapsed, and lengths are capped.
//
// Times: `YYYYMMDDhhmmss ±hhmm` (seconds, minutes and the offset are optional; a missing offset
// means UTC, as the XMLTV DTD says). A programme without `stop` ends when the next programme of
// the same channel starts (feeds list each channel's programmes in order); the last one of a
// channel without `stop` is dropped.

export interface XmltvChannel {
  id: string;
  /** `<display-name>` texts, in document order. */
  names: string[];
}

export interface XmltvProgramme {
  /** `channel` attribute: the XMLTV channel id. */
  channel: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms; always after `start`. */
  end: number;
  title: string;
  desc?: string;
}

export interface XmltvHandlers {
  channel?(channel: XmltvChannel): void;
  programme?(programme: XmltvProgramme): void;
}

export const MAX_TITLE_LENGTH = 300;
export const MAX_DESC_LENGTH = 1_000;
export const MAX_NAME_LENGTH = 200;
export const MAX_ID_LENGTH = 300;
/** Unterminated markup (or text inside a captured element) longer than this is a broken file. */
export const MAX_PENDING_CHARS = 1_000_000;
/** At most this many display names are kept per channel. */
const MAX_NAMES = 8;

export class XmltvParseError extends Error {
  override readonly name = 'XmltvParseError';
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,15});/g;

/** Decodes XML entities as text (unknown named entities are left as they are). */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      const valid =
        Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '�';
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;

function cleanText(text: string, max: number): string {
  const clean = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const TIME =
  /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|Z|UTC|GMT)?$/i;

/** Epoch ms of an XMLTV time, or `undefined` when it is not one. */
export function parseXmltvTime(value: string | undefined): number | undefined {
  const match = value === undefined ? null : TIME.exec(value.trim());
  if (!match) return undefined;
  const [, y, mo, d, h = '0', mi = '0', s = '0', sign, oh, om] = match;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return undefined;
  }
  let ms = Date.UTC(Number(y), month - 1, day, hour, minute, second);
  if (sign !== undefined) {
    const offset = (Number(oh) * 60 + Number(om)) * 60_000;
    ms -= sign === '-' ? -offset : offset;
  }
  return Number.isFinite(ms) ? ms : undefined;
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1] as string;
    if (!attributes.has(name)) attributes.set(name, decodeXmlEntities(match[2] ?? match[3] ?? ''));
  }
  return attributes;
}

interface Capture {
  element: 'display-name' | 'title' | 'desc';
  parts: string[];
  length: number;
  max: number;
}

interface OpenProgramme {
  channel: string;
  start: number | undefined;
  stop: number | undefined;
  title?: string;
  desc?: string;
}

export interface XmltvParseStats {
  channels: number;
  /** Programmes handed to `handlers.programme`. */
  programmes: number;
  /** Programmes dropped: no channel, title or valid times. */
  skipped: number;
}

export class XmltvParser {
  /** Whether the `<tv>` root element was seen (the body is XMLTV). */
  sawRoot = false;
  readonly stats: XmltvParseStats = { channels: 0, programmes: 0, skipped: 0 };

  private buffer = '';
  private channel: XmltvChannel | undefined;
  private programme: OpenProgramme | undefined;
  private capture: Capture | undefined;
  /** Per channel: the last programme without `stop`, waiting for the next one's start. */
  private readonly openEnded = new Map<string, Omit<XmltvProgramme, 'end'>>();
  private ended = false;

  constructor(private readonly handlers: XmltvHandlers) {}

  write(chunk: string): void {
    if (this.ended) throw new XmltvParseError('write after end');
    this.buffer = this.buffer === '' ? chunk : this.buffer + chunk;
    this.process(false);
  }

  end(): void {
    if (this.ended) return;
    this.process(true);
    this.ended = true;
    this.buffer = '';
    this.openEnded.clear();
  }

  private process(final: boolean): void {
    const s = this.buffer;
    const n = s.length;
    let i = 0;
    while (i < n) {
      const lt = s.indexOf('<', i);
      if (lt === -1) {
        i = this.trailingText(s, i, final);
        break;
      }
      if (lt > i && this.capture) this.text(s.slice(i, lt));
      const next = this.markup(s, lt, final);
      if (next === -1) {
        i = lt;
        break;
      }
      i = next;
    }
    this.buffer = i >= n ? '' : s.slice(i);
    if (this.buffer.length > MAX_PENDING_CHARS) {
      throw new XmltvParseError('unterminated markup or oversized text');
    }
  }

  /** Text after the last `<` of the buffer; returns where the unconsumed rest starts. */
  private trailingText(s: string, from: number, final: boolean): number {
    if (!this.capture) return s.length;
    if (final) {
      this.text(s.slice(from));
      return s.length;
    }
    // Keep a possibly split entity (`&am` + `p;`) for the next chunk.
    const amp = s.lastIndexOf('&');
    const keepFrom = amp >= from && !s.includes(';', amp) && s.length - amp <= 16 ? amp : s.length;
    if (keepFrom > from) this.text(s.slice(from, keepFrom));
    return keepFrom;
  }

  /** Handles the markup at `lt`; returns the index after it, or -1 when it is incomplete. */
  private markup(s: string, lt: number, final: boolean): number {
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      return end === -1 ? -1 : end + 3;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      if (end === -1) return -1;
      if (this.capture) this.append(s.slice(lt + 9, end));
      return end + 3;
    }
    if (!final && s.length - lt < 9) {
      // A chunk may end inside `<!--` or `<![CDATA[`: wait for the rest before deciding.
      const rest = s.slice(lt);
      if ('<![CDATA['.startsWith(rest) || '<!--'.startsWith(rest)) return -1;
    }
    if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      return end === -1 ? -1 : end + 2;
    }
    if (s.startsWith('<!', lt)) {
      // DOCTYPE (with an optional internal subset) or another declaration.
      const close = s.indexOf('>', lt);
      const bracket = s.indexOf('[', lt);
      if (bracket !== -1 && (close === -1 || bracket < close)) {
        const end = s.indexOf(']>', bracket);
        return end === -1 ? -1 : end + 2;
      }
      return close === -1 ? -1 : close + 1;
    }
    if (s[lt + 1] === '/') {
      const end = s.indexOf('>', lt);
      if (end === -1) return -1;
      this.close(s.slice(lt + 2, end).trim());
      return end + 1;
    }
    // Start tag: find its `>` outside quoted attribute values.
    let quote = '';
    for (let j = lt + 1; j < s.length; j++) {
      const c = s[j];
      if (quote !== '') {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        const selfClosing = s[j - 1] === '/';
        const inner = s.slice(lt + 1, selfClosing ? j - 1 : j);
        const space = inner.search(/\s/);
        const name = space === -1 ? inner : inner.slice(0, space);
        this.open(name, space === -1 ? '' : inner.slice(space));
        if (selfClosing) this.close(name);
        return j + 1;
      }
    }
    return -1;
  }

  private open(name: string, rawAttributes: string): void {
    switch (name) {
      case 'tv':
        this.sawRoot = true;
        return;
      case 'channel':
        if (this.programme) return;
        this.channel = {
          id: cleanText(parseAttributes(rawAttributes).get('id') ?? '', MAX_ID_LENGTH),
          names: [],
        };
        return;
      case 'programme': {
        const attributes = parseAttributes(rawAttributes);
        this.programme = {
          channel: cleanText(attributes.get('channel') ?? '', MAX_ID_LENGTH),
          start: parseXmltvTime(attributes.get('start')),
          stop: parseXmltvTime(attributes.get('stop')),
        };
        return;
      }
      case 'display-name':
        if (this.channel && !this.capture && this.channel.names.length < MAX_NAMES) {
          this.startCapture('display-name', MAX_NAME_LENGTH);
        }
        return;
      case 'title':
        if (this.programme?.title === undefined && this.programme && !this.capture) {
          this.startCapture('title', MAX_TITLE_LENGTH);
        }
        return;
      case 'desc':
        if (this.programme?.desc === undefined && this.programme && !this.capture) {
          this.startCapture('desc', MAX_DESC_LENGTH);
        }
        return;
      default:
        return;
    }
  }

  private close(name: string): void {
    const capture = this.capture;
    if (capture) {
      this.capture = undefined;
      if (name === capture.element) {
        const text = cleanText(capture.parts.join(''), capture.max);
        if (text === '') return;
        if (capture.element === 'display-name') this.channel?.names.push(text);
        else if (this.programme) this.programme[capture.element] = text;
        return;
      }
      // Markup nested inside the text is ignored; an unclosed text element ends with its parent.
      if (name !== 'programme' && name !== 'channel') {
        this.capture = capture;
        return;
      }
    }
    if (name === 'channel' && this.channel) {
      const channel = this.channel;
      this.channel = undefined;
      if (channel.id === '') return;
      this.stats.channels++;
      this.handlers.channel?.(channel);
    } else if (name === 'programme' && this.programme) {
      const programme = this.programme;
      this.programme = undefined;
      this.finishProgramme(programme);
    }
  }

  private finishProgramme(p: OpenProgramme): void {
    const { channel, start, title } = p;
    if (channel === '' || start === undefined || title === undefined) {
      this.stats.skipped++;
      return;
    }
    const waiting = this.openEnded.get(channel);
    if (waiting) {
      this.openEnded.delete(channel);
      if (waiting.start < start) this.emit({ ...waiting, end: start });
      else this.stats.skipped++;
    }
    const base: Omit<XmltvProgramme, 'end'> = { channel, start, title };
    if (p.desc !== undefined) base.desc = p.desc;
    if (p.stop === undefined) {
      this.openEnded.set(channel, base);
    } else if (p.stop > start) {
      this.emit({ ...base, end: p.stop });
    } else {
      this.stats.skipped++;
    }
  }

  private emit(programme: XmltvProgramme): void {
    this.stats.programmes++;
    this.handlers.programme?.(programme);
  }

  private startCapture(element: Capture['element'], max: number): void {
    this.capture = { element, parts: [], length: 0, max };
  }

  private text(raw: string): void {
    this.append(decodeXmlEntities(raw));
  }

  private append(text: string): void {
    const capture = this.capture;
    // Keep a little more than the cap so `cleanText` can trim whitespace and add the ellipsis.
    if (!capture || capture.length > capture.max * 2) return;
    capture.parts.push(text);
    capture.length += text.length;
  }
}
