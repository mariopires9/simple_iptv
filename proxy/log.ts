// The only proxy module allowed to write to the console (ESLint: `no-console` is off here only).
//
// Privacy rule (PRX-01, docs/SECURITY.md §4): the proxy never logs hosts, paths, query strings,
// tokens, grants or encoded URLs. This logger therefore accepts only a closed set of fields whose
// values cannot carry them: a known event name, a status number, a known error code, a duration and
// a byte count. Anything else is dropped before it reaches the console.

export const LOG_EVENTS = [
  'startup',
  'request',
  'upstream-error',
  'server-error',
  'shutdown',
  'config-error',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

export interface LogFields {
  event: LogEvent;
  status?: number;
  /** A proxy error code (`X-Simple-Iptv-Proxy-Error`) or a Node error code/name. */
  code?: string;
  durationMs?: number;
  bytes?: number;
  /** Startup only: the listening port and the number of configured hosts/origins. */
  port?: number;
  allowedHosts?: number;
  allowedOrigins?: number;
}

export type LogSink = (line: string) => void;

const EVENTS: ReadonlySet<string> = new Set(LOG_EVENTS);
const NUMERIC_FIELDS = [
  'status',
  'durationMs',
  'bytes',
  'port',
  'allowedHosts',
  'allowedOrigins',
] as const;
// Proxy codes are kebab-case words; Node codes are upper snake case (ECONNRESET, ERR_TLS_…);
// error names are words (AbortError). None of these can hold a host, path or token.
const CODE_PATTERN = /^(?=.{1,40}$)(?:[a-z]+(?:-[a-z]+){0,4}|[A-Z][A-Z0-9_]+|[A-Z][A-Za-z]+)$/;

/** Keeps only the whitelisted fields, with values that match their expected shape. */
export function sanitizeLogFields(fields: LogFields): Record<string, string | number> | null {
  if (!EVENTS.has(fields.event)) return null;
  const out: Record<string, string | number> = { event: fields.event };
  for (const key of NUMERIC_FIELDS) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.round(value);
  }
  if (typeof fields.code === 'string' && CODE_PATTERN.test(fields.code)) out.code = fields.code;
  return out;
}

/** The code of an unknown error: `error.code` or `error.name` when they look like codes. */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === 'string' && CODE_PATTERN.test(code)) return code;
    if (typeof name === 'string' && CODE_PATTERN.test(name)) return name;
  }
  return 'Error';
}

export interface Logger {
  log(fields: LogFields): void;
}

/** A logger writing one JSON line per event (stderr for errors, stdout otherwise). */
export function createLogger(sinks?: { out?: LogSink; err?: LogSink }): Logger {
  const out = sinks?.out ?? ((line: string) => console.log(line));
  const err = sinks?.err ?? ((line: string) => console.error(line));
  return {
    log(fields) {
      const safe = sanitizeLogFields(fields);
      if (safe === null) return;
      const line = JSON.stringify({ time: new Date().toISOString(), ...safe });
      if (fields.event.endsWith('error')) err(line);
      else out(line);
    },
  };
}

/**
 * Configuration problems at startup. `message` is a fixed, value-free sentence built by
 * config.ts (it names the offending field, never its content).
 */
export function logConfigProblem(message: string): void {
  console.error(`simple-iptv-proxy: ${message}`);
}

/** CLI output that is meant for the owner's eyes only (`--generate-token`, `--help`). */
export function printCliOutput(text: string): void {
  console.log(text);
}
