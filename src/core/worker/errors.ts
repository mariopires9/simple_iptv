// Erros das tarefas do worker de dados — FND-07 CA2.
// Só name/kind/message atravessam a fronteira do worker: nunca stack, cause ou propriedades extra,
// que podem conter URLs com credenciais ou dados das listas do utilizador.
// A mensagem é diagnóstica (como em NetError), não texto de UI: a UI traduz `kind` para pt-PT
// a partir de src/i18n.

export type WorkerTaskErrorKind = 'cancelled' | 'failed';

/** Forma exata que viaja do worker para a thread principal (clonável por structured clone). */
export interface SerializedTaskError {
  name: 'WorkerTaskError';
  kind: WorkerTaskErrorKind;
  message: string;
}

export const CANCELLED_MESSAGE = 'Tarefa cancelada';
export const FAILED_MESSAGE = 'Falha na tarefa do worker';

/**
 * Nomes de erro nativos que podem ser indicados (só o nome, nunca a mensagem): ajudam no
 * diagnóstico sem revelar dados. Ex.: a mensagem de um SyntaxError do JSON.parse ecoa o input.
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
 * Reduz qualquer valor lançado a {name, kind, message}. Usado dentro do worker.
 * Só a mensagem de um `WorkerTaskError` (escrita pela própria tarefa) atravessa a fronteira;
 * qualquer outro erro (JSON.parse, DOMException, Dexie…) fica com uma mensagem genérica.
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

/** Recria o erro do lado do cliente; tolera formas inesperadas (o worker é outra fronteira). */
export function deserializeTaskError(data: unknown): WorkerTaskError {
  const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const kind: WorkerTaskErrorKind = obj['kind'] === 'cancelled' ? 'cancelled' : 'failed';
  const message = typeof obj['message'] === 'string' ? obj['message'] : undefined;
  return new WorkerTaskError(kind, message);
}
