// Network error model (FND-06, docs/ARCHITECTURE.md §4 and §8).
// The UI maps `kind` → a localized message; the `message` here is for diagnostics and never contains credentials.
import { MASK, redact, toLogJson } from '@/core/log';

export type NetErrorKind =
  'offline' | 'timeout' | 'aborted' | 'blocked' | 'http' | 'auth' | 'parse';

export type NetErrorHint = 'mixed-content' | 'cors';

export interface NetErrorInit {
  kind: NetErrorKind;
  status?: number;
  hint?: NetErrorHint;
  /** Request URL. Never stored: only the shortened, redacted form (`target`). */
  url?: string;
  cause?: unknown;
}

const DESCRIPTIONS: Record<NetErrorKind, string> = {
  offline: 'No network connection',
  timeout: 'Request timed out',
  aborted: 'Request aborted',
  blocked: 'Request blocked by the browser',
  http: 'Unexpected HTTP response',
  auth: 'Authentication rejected',
  parse: 'Invalid response',
};

/** Known first segments (Xtream endpoints and stream types) that may stay visible. */
const SAFE_FIRST_SEGMENTS = new Set([
  'player_api.php',
  'get.php',
  'xmltv.php',
  'live',
  'movie',
  'series',
  'timeshift',
]);
const EXTENSION = /\.([A-Za-z0-9]{1,5})$/;

// Shortens a URL for diagnostics. Rule: the host (with port and userinfo) becomes `***`; the query and
// fragment are dropped; of the path, only the first segment is kept if it is known
// (`SAFE_FIRST_SEGMENTS`) plus the extension of the last segment — every other segment becomes `***`.
// Examples (line comment because `***/` would close a /** */ block):
//   http://h:8080/player_api.php?username=… → http://***/player_api.php
//   http://h/live/u/p/1.ts                  → http://***/live/***/***/***.ts
//   http://h/u/p/1.ts                       → http://***/***/***/***.ts
export function shortenUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!parsed.host) return `${parsed.protocol}${MASK}`;
  const segments = parsed.pathname.split('/').slice(1);
  const masked = segments.map((segment, i) => {
    if (segment === '') return '';
    if (i === 0 && SAFE_FIRST_SEGMENTS.has(segment.toLowerCase())) return segment;
    const ext = i === segments.length - 1 ? EXTENSION.exec(segment) : null;
    return ext ? `${MASK}.${ext[1]}` : MASK;
  });
  return redact(`${parsed.protocol}//${MASK}/${masked.join('/')}`);
}

const MAX_CAUSE_DEPTH = 3;

/**
 * The original cause may carry the full URL in its message: only a redacted copy is kept,
 * including the `cause` chain up to `MAX_CAUSE_DEPTH` levels.
 */
function sanitizeCause(cause: unknown, depth = 1): unknown {
  if (cause === undefined || depth > MAX_CAUSE_DEPTH) return undefined;
  if (cause instanceof Error) {
    const inner = sanitizeCause((cause as { cause?: unknown }).cause, depth + 1);
    const copy = new Error(
      redact(cause.message),
      inner !== undefined ? { cause: inner } : undefined,
    );
    copy.name = cause.name;
    copy.stack = cause.stack !== undefined ? redact(cause.stack) : undefined;
    return copy;
  }
  if (cause !== null && typeof cause === 'object') return toLogJson(cause);
  return redact(String(cause));
}

export class NetError extends Error {
  override readonly name = 'NetError';
  readonly kind: NetErrorKind;
  readonly status?: number;
  readonly hint?: NetErrorHint;
  /** Shortened, redacted URL (scheme + `***` + path, no query). */
  readonly target?: string;

  constructor({ kind, status, hint, url, cause }: NetErrorInit) {
    const target = url !== undefined ? shortenUrl(url) : undefined;
    const parts = [`${DESCRIPTIONS[kind]} (${kind}`];
    if (status !== undefined) parts.push(`, HTTP ${status}`);
    if (hint !== undefined) parts.push(`, ${hint}`);
    parts.push(')');
    if (target !== undefined) parts.push(`: ${target}`);
    const safeCause = sanitizeCause(cause);
    super(parts.join(''), safeCause !== undefined ? { cause: safeCause } : undefined);
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (hint !== undefined) this.hint = hint;
    if (target !== undefined) this.target = target;
  }
}

export function isNetError(e: unknown): e is NetError {
  return e instanceof NetError;
}
