// Logger with redaction and a ring buffer for the "Diagnostics report" (FND-06).
// The only place in the app allowed to write to the console (eslint.config.js).
import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  message: string;
  /** Context already serialized to JSON and redacted. */
  context?: string;
}

export const LOG_BUFFER_SIZE = 500;

const buffer: LogEntry[] = [];

const MAX_DEPTH = 12;

/**
 * Converts an arbitrary value into a JSON-serializable tree. Only ancestors count as a cycle
 * (`{a: s, b: s}` serializes `s` twice); `Error` goes through the same check (`e.cause = e`).
 */
function toPlain(value: unknown, ancestors: object[]): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.includes(value)) return '[Circular]';
  if (ancestors.length >= MAX_DEPTH) return '[…]';
  ancestors.push(value);
  try {
    if (value instanceof Error) {
      const out: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      for (const [k, v] of Object.entries(value)) out[k] = toPlain(v, ancestors);
      const cause = (value as { cause?: unknown }).cause;
      if (cause !== undefined) out.cause = toPlain(cause, ancestors);
      return out;
    }
    const withJson = value as { toJSON?: unknown };
    if (typeof withJson.toJSON === 'function') {
      return toPlain((withJson.toJSON as () => unknown).call(value), ancestors);
    }
    if (Array.isArray(value)) return value.map((v) => toPlain(v, ancestors));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v, ancestors);
    return out;
  } finally {
    ancestors.pop();
  }
}

/** Redacted JSON of any value (log context, error causes). Never throws. */
export function toLogJson(value: unknown): string {
  try {
    return redact(JSON.stringify(toPlain(value, [])) ?? String(value));
  } catch {
    return '[unserializable context]';
  }
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = { at: Date.now(), level, message: redact(String(message)) };
  if (context !== undefined) entry.context = toLogJson(context);

  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_SIZE) buffer.splice(0, buffer.length - LOG_BUFFER_SIZE);

  if (level === 'debug' && import.meta.env.PROD) return;
  const args: unknown[] = [`[${level}] ${entry.message}`];
  if (entry.context !== undefined) args.push(entry.context);
  console[level](...args);
}

export const log = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
} as const;

/** Copy of the buffer entries (oldest first). */
export function getLogEntries(): LogEntry[] {
  return buffer.map((e) => ({ ...e }));
}

export function clearLogBuffer(): void {
  buffer.length = 0;
}

/**
 * Plain-text diagnostics report. It is redacted again at export time, to also remove secrets
 * registered after the entry was written.
 */
export function exportDiagnostics(): string {
  // The header is fixed app text: it is not redacted, so a short secret (e.g. "IPTV") cannot mangle it.
  const header = [
    'Diagnostics report — Simple IPTV',
    `Generated at: ${new Date().toISOString()}`,
    `Entries: ${buffer.length}`,
    '',
  ];
  const lines: string[] = [];
  for (const e of buffer) {
    lines.push(`${new Date(e.at).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.message}`);
    if (e.context !== undefined) lines.push(`    context: ${e.context}`);
  }
  return [...header, ...lines.map(redact)].join('\n') + '\n';
}
