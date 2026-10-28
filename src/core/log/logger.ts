// Logger com redação e buffer circular para o "Relatório de diagnóstico" (FND-06).
// Único ponto da app autorizado a escrever na consola (eslint.config.js).
import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  message: string;
  /** Contexto já serializado em JSON e redigido. */
  context?: string;
}

export const LOG_BUFFER_SIZE = 500;

const buffer: LogEntry[] = [];

/** Serializa o contexto em JSON, incluindo `Error` (name/message/stack/cause) e referências circulares. */
function serialize(context: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    if (value instanceof Error) {
      const { name, message, stack } = value;
      const own = Object.fromEntries(Object.entries(value));
      const cause = (value as { cause?: unknown }).cause;
      return { name, message, stack, ...own, ...(cause !== undefined ? { cause } : {}) };
    }
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(context, replacer) ?? '';
  } catch {
    return '[contexto não serializável]';
  }
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = { at: Date.now(), level, message: redact(String(message)) };
  if (context !== undefined) entry.context = redact(serialize(context));

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

/** Cópia das entradas do buffer (mais antiga primeiro). */
export function getLogEntries(): LogEntry[] {
  return buffer.map((e) => ({ ...e }));
}

export function clearLogBuffer(): void {
  buffer.length = 0;
}

/**
 * Relatório de diagnóstico em texto simples. É redigido de novo no momento da exportação,
 * para remover também segredos registados depois de a entrada ter sido escrita.
 */
export function exportDiagnostics(): string {
  const lines = [
    'Relatório de diagnóstico — Simple IPTV',
    `Gerado em: ${new Date().toISOString()}`,
    `Entradas: ${buffer.length}`,
    '',
  ];
  for (const e of buffer) {
    lines.push(`${new Date(e.at).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.message}`);
    if (e.context !== undefined) lines.push(`    contexto: ${e.context}`);
  }
  return redact(lines.join('\n') + '\n');
}
