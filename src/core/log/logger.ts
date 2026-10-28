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

const MAX_DEPTH = 12;

/**
 * Converte um valor arbitrário numa árvore serializável em JSON. Só os antepassados contam como
 * ciclo (`{a: s, b: s}` serializa `s` duas vezes); `Error` entra no mesmo controlo (`e.cause = e`).
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

/** JSON redigido de qualquer valor (contexto de log, causas de erro). Nunca lança. */
export function toLogJson(value: unknown): string {
  try {
    return redact(JSON.stringify(toPlain(value, [])) ?? String(value));
  } catch {
    return '[contexto não serializável]';
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
  // O cabeçalho é texto fixo da app: não é redigido, para um segredo curto (ex.: "IPTV") não o estragar.
  const header = [
    'Relatório de diagnóstico — Simple IPTV',
    `Gerado em: ${new Date().toISOString()}`,
    `Entradas: ${buffer.length}`,
    '',
  ];
  const lines: string[] = [];
  for (const e of buffer) {
    lines.push(`${new Date(e.at).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.message}`);
    if (e.context !== undefined) lines.push(`    contexto: ${e.context}`);
  }
  return [...header, ...lines.map(redact)].join('\n') + '\n';
}
