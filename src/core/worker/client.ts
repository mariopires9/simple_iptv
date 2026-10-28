// Cliente do worker de dados (thread principal) — FND-07 (ADR-009).
// Um único worker, criado à primeira utilização; as tarefas partilham-no e correm intercaladas.
//
// Cancelamento: `AbortSignal` não é transferível, por isso cada chamada recebe um `taskId` e, no
// `abort`, o cliente chama `api.cancel(taskId)`; a tarefa termina no próximo `throwIfCancelled()`.
// A promessa rejeita logo com kind 'cancelled' (semântica igual à de `fetch` com `signal`) e o
// progresso deixa de ser entregue, mesmo que o worker ainda demore a parar.
//
// Falha do worker: um evento `error`/`messageerror` (ou `terminateDataWorker()`) rejeita todas as
// chamadas em curso com kind 'failed' e descarta o singleton; a chamada seguinte cria um novo.

import { expose, transfer, wrap, type Remote } from 'comlink';
import type { DataWorkerApi, TaskResult } from './api';
import { WorkerTaskError, deserializeTaskError } from './errors';
import type { TaskInput, TaskName, TaskOutput, TaskProgress } from './tasks';

export interface RunTaskOptions {
  onProgress?: (p: TaskProgress) => void;
  signal?: AbortSignal;
}

export type DataWorkerRemote = Remote<DataWorkerApi>;

interface Instance {
  worker: Worker;
  api: DataWorkerRemote;
  /** Abortado (com um WorkerTaskError como `reason`) quando o worker morre ou é terminado. */
  lifetime: AbortController;
}

let instance: Instance | undefined;
let nextTaskId = 1;

function ensureInstance(): Instance {
  if (instance) return instance;
  // O padrão `new Worker(new URL(...), { type: 'module' })` é o que o Vite reconhece para
  // emitir o worker como chunk separado (FND-07 CA3).
  const worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
    type: 'module',
    name: 'data',
  });
  const current: Instance = {
    worker,
    api: wrap<DataWorkerApi>(worker),
    lifetime: new AbortController(),
  };
  const onFailure = () => endInstance(current, 'O worker de dados falhou');
  worker.addEventListener('error', onFailure);
  worker.addEventListener('messageerror', onFailure);
  instance = current;
  return current;
}

function endInstance(target: Instance, message: string): void {
  target.lifetime.abort(new WorkerTaskError('failed', message));
  target.worker.terminate();
  if (instance === target) instance = undefined;
}

/** Devolve o proxy Comlink do worker de dados, criando-o na primeira chamada. */
export function getDataWorker(): DataWorkerRemote {
  return ensureInstance().api;
}

/** Termina o worker (testes, limpeza). Chamadas em curso rejeitam com kind 'failed'. */
export function terminateDataWorker(): void {
  if (instance) endInstance(instance, 'O worker de dados foi terminado');
}

/** Corre uma tarefa registada em tasks.ts no worker de dados. */
export function runTask<N extends TaskName>(
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  const { api, lifetime } = ensureInstance();
  return execute(api, name, input, options, lifetime.signal);
}

/** Variante com o proxy explícito — permite testar com um MessageChannel em vez de um Worker. */
export function runTaskOn<N extends TaskName>(
  api: DataWorkerRemote,
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  return execute(api, name, input, options);
}

function transportError(err: unknown): WorkerTaskError {
  // Falha de transporte (ex.: input não clonável): não reenviar detalhes do erro original.
  return new WorkerTaskError(
    'failed',
    err instanceof Error && err.name === 'DataCloneError'
      ? 'Dados da tarefa não são transferíveis para o worker'
      : 'Falha na comunicação com o worker',
  );
}

async function execute<N extends TaskName>(
  api: DataWorkerRemote,
  name: N,
  input: TaskInput<N>,
  { onProgress, signal }: RunTaskOptions,
  lifetime?: AbortSignal,
): Promise<TaskOutput<N>> {
  if (signal?.aborted) throw new WorkerTaskError('cancelled');
  if (lifetime?.aborted) throw lifetimeError(lifetime);

  const taskId = nextTaskId++;
  let settled = false;

  // Canal próprio para o progresso: o cliente é dono das duas portas e fecha-o sempre no fim.
  const channel = onProgress ? new MessageChannel() : undefined;
  if (channel && onProgress) {
    expose((p: TaskProgress) => {
      if (!settled && !signal?.aborted) onProgress(p);
    }, channel.port1);
  }

  let removeListeners = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      api.cancel(taskId).catch(() => undefined);
      reject(new WorkerTaskError('cancelled'));
    };
    const onEnd = () => reject(lifetime ? lifetimeError(lifetime) : new WorkerTaskError('failed'));
    signal?.addEventListener('abort', onAbort, { once: true });
    lifetime?.addEventListener('abort', onEnd, { once: true });
    removeListeners = () => {
      signal?.removeEventListener('abort', onAbort);
      lifetime?.removeEventListener('abort', onEnd);
    };
  });

  const call = (async () => {
    try {
      return await api.run(
        taskId,
        name,
        input,
        channel ? transfer(channel.port2, [channel.port2]) : undefined,
      );
    } catch (err) {
      throw transportError(err);
    }
  })();
  // A perdedora da corrida não deve gerar "unhandled rejection".
  call.catch(() => undefined);
  interrupted.catch(() => undefined);

  try {
    const result: TaskResult = await Promise.race([call, interrupted]);
    // Se o utilizador abortou, prevalece 'cancelled' mesmo que a tarefa tenha falhado entretanto.
    if (signal?.aborted) throw new WorkerTaskError('cancelled');
    if (!result.ok) throw deserializeTaskError(result.error);
    return result.value as TaskOutput<N>;
  } finally {
    settled = true;
    removeListeners();
    channel?.port1.close();
  }
}

function lifetimeError(lifetime: AbortSignal): WorkerTaskError {
  const reason: unknown = lifetime.reason;
  // Instância nova por chamada: cada promessa rejeitada tem o seu próprio erro.
  return new WorkerTaskError(
    'failed',
    reason instanceof WorkerTaskError ? reason.message : undefined,
  );
}
