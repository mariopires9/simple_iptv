// Data worker task errors — FND-07 AC2.
// Only name/kind/message cross the worker boundary: never stack, cause or extra properties,
// which may contain URLs with credentials or data from the user's lists.
// The message is diagnostic (as in NetError), not UI text: the UI maps `kind` to a localized
// message from src/i18n (en base locale, ADR-015).

export type WorkerTaskErrorKind = 'cancelled' | 'failed';

/** Exact shape that travels from the worker to the main thread (structured-clone cloneable). */
export interface SerializedTaskError {
  name: 'WorkerTaskError';
  kind: WorkerTaskErrorKind;
  message: string;
}

export const CANCELLED_MESSAGE = 'Task cancelled';
export const FAILED_MESSAGE = 'Worker task failed';

/**
 * Native error names that may be reported (only the name, never the message): they help
 * diagnostics without revealing data. E.g. the message of a JSON.parse SyntaxError echoes the input.
 */
const SAFE_ERROR_NAMES = new Set([
  'SyntaxError',
  'TypeError',
  'QuotaExceededError',
  'DataCloneError',
]);

export class WorkerTaskError extends Error {
  override readonly name = 'WorkerTaskError' as const;
  readonly kind: WorkerTaskErrorKind;

  constructor(kind: WorkerTaskErrorKind, message?: string) {
    super(message ?? (kind === 'cancelled' ? CANCELLED_MESSAGE : FAILED_MESSAGE));
    this.kind = kind;
  }
}

/**
 * Reduces any thrown value to {name, kind, message}. Used inside the worker.
 * Only the message of a `WorkerTaskError` (written by the task itself) crosses the boundary;
 * any other error (JSON.parse, DOMException, Dexie…) gets a generic message.
 */
export function serializeTaskError(err: unknown): SerializedTaskError {
  if (err instanceof WorkerTaskError) {
    return { name: 'WorkerTaskError', kind: err.kind, message: err.message };
  }
  const name =
    typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  const message =
    typeof name === 'string' && SAFE_ERROR_NAMES.has(name)
      ? `${FAILED_MESSAGE} (${name})`
      : FAILED_MESSAGE;
  return { name: 'WorkerTaskError', kind: 'failed', message };
}

/** Recreates the error on the client side; tolerates unexpected shapes (the worker is another boundary). */
export function deserializeTaskError(data: unknown): WorkerTaskError {
  const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const kind: WorkerTaskErrorKind = obj['kind'] === 'cancelled' ? 'cancelled' : 'failed';
  const message = typeof obj['message'] === 'string' ? obj['message'] : undefined;
  return new WorkerTaskError(kind, message);
}
