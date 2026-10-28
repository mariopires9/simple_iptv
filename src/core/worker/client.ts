// Cliente do worker de dados (thread principal) — FND-07 (ADR-009).
// Um único worker, criado à primeira utilização; as tarefas partilham-no e correm intercaladas.
//
// Cancelamento: `AbortSignal` não é transferível, por isso cada chamada recebe um `taskId` e, no
// `abort`, o cliente chama `api.cancel(taskId)`; a tarefa termina no próximo `throwIfCancelled()`.
// Se a tarefa acabar sem verificar o cancelamento, o resultado é descartado e a promessa rejeita
// na mesma com kind 'cancelled' (semântica igual à de `fetch` com `signal`).

import { proxy, wrap, type Remote } from 'comlink';
import type { DataWorkerApi, TaskResult } from './api';
import { WorkerTaskError, deserializeTaskError } from './errors';
import type { TaskInput, TaskName, TaskOutput, TaskProgress } from './tasks';

export interface RunTaskOptions {
  onProgress?: (p: TaskProgress) => void;
  signal?: AbortSignal;
}

export type DataWorkerRemote = Remote<DataWorkerApi>;

let instance: { worker: Worker; api: DataWorkerRemote } | undefined;
let nextTaskId = 1;

/** Devolve o proxy Comlink do worker de dados, criando-o na primeira chamada. */
export function getDataWorker(): DataWorkerRemote {
  if (!instance) {
    // O padrão `new Worker(new URL(...), { type: 'module' })` é o que o Vite reconhece para
    // emitir o worker como chunk separado (FND-07 CA3).
    const worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
      name: 'data',
    });
    instance = { worker, api: wrap<DataWorkerApi>(worker) };
  }
  return instance.api;
}

/** Termina o worker (testes, limpeza). Tarefas em curso ficam sem resposta. */
export function terminateDataWorker(): void {
  instance?.worker.terminate();
  instance = undefined;
}

/** Corre uma tarefa registada em tasks.ts no worker de dados. */
export function runTask<N extends TaskName>(
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  return runTaskOn(getDataWorker(), name, input, options);
}

/** Variante com o proxy explícito — permite testar com um MessageChannel em vez de um Worker. */
export async function runTaskOn<N extends TaskName>(
  api: DataWorkerRemote,
  name: N,
  input: TaskInput<N>,
  { onProgress, signal }: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  if (signal?.aborted) throw new WorkerTaskError('cancelled');

  const taskId = nextTaskId++;
  const onAbort = () => {
    api.cancel(taskId).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let result: TaskResult;
  try {
    result = await api.run(taskId, name, input, onProgress ? proxy(onProgress) : undefined);
  } catch (err) {
    // Falha de transporte (ex.: input não clonável): não reenviar detalhes do erro original.
    throw new WorkerTaskError(
      'failed',
      err instanceof Error && err.name === 'DataCloneError'
        ? 'Dados da tarefa não são transferíveis para o worker'
        : 'Falha na comunicação com o worker',
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (!result.ok) throw deserializeTaskError(result.error);
  if (signal?.aborted) throw new WorkerTaskError('cancelled');
  return result.value as TaskOutput<N>;
}
