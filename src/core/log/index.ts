// Módulo core/log — logger com redação de credenciais (FND-06, docs/ARCHITECTURE.md §8).
export { MASK, redact, registerSecret, unregisterSecret, clearSecrets } from './redact';
export {
  log,
  exportDiagnostics,
  clearLogBuffer,
  getLogEntries,
  toLogJson,
  LOG_BUFFER_SIZE,
} from './logger';
export type { LogEntry, LogLevel } from './logger';
