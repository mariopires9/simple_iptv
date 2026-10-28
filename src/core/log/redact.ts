// Central credential redaction (FND-06, docs/ARCHITECTURE.md §8, docs/SECURITY.md).
// Everything that goes to the console, error messages or diagnostics reports passes through here.

export const MASK = '***';

/** Secrets shorter than this are ignored so as not to destroy ordinary text. */
const MIN_SECRET_LENGTH = 3;

/** Sensitive words; they match as the full name or a suffix (`api_key`, `access-token`, `accessToken`). */
const SENSITIVE_WORDS = ['authorization', 'username', 'password', 'token', 'pass', 'auth', 'key'];

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

/**
 * Decides whether a parameter/field name is sensitive: it ends in a sensitive word that starts at a
 * boundary — start of the name, after `_`/`-`, or the start of a camelCase word (`apiKey`).
 * So `passport`, `bypass`, `monkey` and `keyboard` do not match; neither does `APIKEY` (no boundary).
 */
function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (!lower.endsWith(word)) continue;
    const i = name.length - word.length;
    if (i === 0) return true;
    const prev = name.charAt(i - 1);
    if (prev === '_' || prev === '-') return true;
    if (isUpper(name.charAt(i)) && !isUpper(prev)) return true;
  }
  return false;
}

/**
 * Parameter name followed by `=` or `%3D`. The lookbehind makes the search start only at the
 * beginning of each name (linear cost). `%26password` shows up as name `26password` preceded by `%`.
 */
const PARAM_NAME = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+)(=|%3D)/gi;
/** Value after `=`: ends at `&`, `#`, whitespace, quotes or end of text. */
const PLAIN_VALUE = /[^&#\s"'<>]*/y;
/** Value after `%3D` (URL inside another parameter): also ends at `%26`. */
const ENCODED_VALUE = /(?:(?!%26)[^&#\s"'<>])*/y;

function redactParams(text: string): string {
  let out = '';
  let last = 0;
  PARAM_NAME.lastIndex = 0;
  for (let m = PARAM_NAME.exec(text); m; m = PARAM_NAME.exec(text)) {
    let name = m[1] ?? '';
    if (text.charAt(m.index - 1) === '%' && /^(?:26|3F|2B)/i.test(name)) name = name.slice(2);
    if (!isSensitiveName(name)) continue;
    const valueStart = m.index + m[0].length;
    const valueRe = m[2] === '=' ? PLAIN_VALUE : ENCODED_VALUE;
    valueRe.lastIndex = valueStart;
    valueRe.exec(text);
    out += text.slice(last, valueStart) + MASK;
    last = Math.max(valueRe.lastIndex, valueStart);
    PARAM_NAME.lastIndex = last;
  }
  return out + text.slice(last);
}

/** JSON key `"name":` — the value (string, number, literal, object or array) is delimited by hand. */
const JSON_KEY = /"([A-Za-z0-9_-]+)"\s*:\s*/g;
const JSON_PRIMITIVE = /[^,}\]\s]*/y;

/** End of the JSON value starting at `start` (lenient: truncated text runs to the end). */
function jsonValueEnd(text: string, start: number): number {
  const c = text.charAt(start);
  if (c === '"') {
    let i = start + 1;
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
    return Math.min(i + 1, text.length);
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const ch = text.charAt(i);
      if (ch === '"') {
        i = jsonValueEnd(text, i);
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      i++;
      if (depth === 0) return i;
    }
    return text.length;
  }
  JSON_PRIMITIVE.lastIndex = start;
  JSON_PRIMITIVE.exec(text);
  return JSON_PRIMITIVE.lastIndex;
}

/** `"password":"abc"`, `"pin":1234`, `"apiKey":{…}` → the whole value becomes `"***"`. */
function redactJsonFields(text: string): string {
  let out = '';
  let last = 0;
  JSON_KEY.lastIndex = 0;
  for (let m = JSON_KEY.exec(text); m; m = JSON_KEY.exec(text)) {
    if (!isSensitiveName(m[1] ?? '')) continue;
    const valueStart = m.index + m[0].length;
    const valueEnd = jsonValueEnd(text, valueStart);
    if (valueEnd <= valueStart) continue;
    out += text.slice(last, valueStart) + `"${MASK}"`;
    last = valueEnd;
    JSON_KEY.lastIndex = last;
  }
  return out + text.slice(last);
}

/** `Authorization: Basic …` header in free text and `Bearer …` tokens. */
const AUTH_HEADER =
  /(?<![A-Za-z0-9_-])((?:proxy-)?authorization\s*:\s*)(?:(basic|bearer|digest|token)\s+)?[^\s"'<>,;]+/gi;
const BEARER = /(?<![A-Za-z0-9_-])(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/** Xtream stream paths: `/live/<user>/<pass>/` (and the `%2F` form). */
const XTREAM_PATH = /\/(live|movie|series|timeshift)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\//gi;
const XTREAM_PATH_ENCODED =
  /%2F(live|movie|series|timeshift)%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F/gi;

/**
 * "Bare" Xtream path (typical get.php output): `scheme://host/<user>/<pass>/<id>.<ext>`, with the
 * path in exactly this shape. May redact harmless URLs with the same shape — acceptable in logs.
 */
const XTREAM_BARE =
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/?#"'<>]+)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\/(\d+(?:\.[A-Za-z0-9]+)?)(?=[\s?#"'<>]|$)/gi;
const XTREAM_BARE_ENCODED =
  /(%3A%2F%2F(?:(?!%2F)[^/\s?#&"'<>])+)%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(\d+(?:\.[A-Za-z0-9]+)?)(?=%26|%3F|%23|[\s&?#"'<>]|$)/gi;

/** Userinfo in URLs: `scheme://user:pass@host`. */
const USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>]+@/gi;

/** Registered secret → every form in which it may appear (plain, URL-encoded, base64). */
const secrets = new Map<string, string[]>();
let sortedForms: string[] | null = null;

function toBase64(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formsOf(value: string): string[] {
  const encoded = encodeURIComponent(value);
  const base64 = toBase64(value);
  return [
    value,
    encoded,
    encoded.replace(/%20/g, '+'),
    new URLSearchParams({ x: value }).toString().slice(2), // application/x-www-form-urlencoded
    encodeURIComponent(encoded), // double-encoded (URL inside a URL)
    base64,
    base64.replace(/=+$/, ''),
    base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), // base64url
  ];
}

/** Registers a sensitive value (e.g. a password) so it is removed from any text. */
export function registerSecret(value: string): void {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return;
  secrets.set(value, formsOf(value));
  sortedForms = null;
}

export function unregisterSecret(value: string): void {
  if (secrets.delete(value)) sortedForms = null;
}

export function clearSecrets(): void {
  secrets.clear();
  sortedForms = null;
}

function secretForms(): string[] {
  if (!sortedForms) {
    const all = new Set<string>();
    for (const forms of secrets.values()) {
      for (const form of forms) if (form.length >= MIN_SECRET_LENGTH) all.add(form);
    }
    // Longest first, so a secret contained in another one leaves no leftovers.
    sortedForms = [...all].sort((a, b) => b.length - a.length);
  }
  return sortedForms;
}

/** Replaces known credentials and credential patterns with `***`. Idempotent. */
export function redact(text: string): string {
  let out = String(text);
  for (const form of secretForms()) {
    if (out.includes(form)) out = out.split(form).join(MASK);
  }
  out = out
    .replace(USERINFO, `$1${MASK}@`)
    .replace(XTREAM_PATH, `/$1/${MASK}/${MASK}/`)
    .replace(XTREAM_PATH_ENCODED, `%2F$1%2F${MASK}%2F${MASK}%2F`)
    .replace(XTREAM_BARE, `$1/${MASK}/${MASK}/$2`)
    .replace(XTREAM_BARE_ENCODED, `$1%2F${MASK}%2F${MASK}%2F$2`)
    .replace(
      AUTH_HEADER,
      (_m, head: string, scheme?: string) => `${head}${scheme ? `${scheme} ` : ''}${MASK}`,
    )
    .replace(BEARER, `$1${MASK}`);
  return redactJsonFields(redactParams(out));
}
