// API exposta pelo worker de dados via Comlink — FND-07 (ADR-009).
// Separada de data.worker.ts para ser testável sem um Worker real (ex.: com MessageChannel).
//
// Erros: em vez de deixar o Comlink serializar a exceção (o handler "throw" por omissão envia
// também `stack`), `run` nunca rejeita — devolve um envelope `{ ok: false, error }` só com
// name/kind/message, e o cliente recria o `WorkerTaskError`. Assim não se mexe no registo global
// `Comlink.transferHandlers` e a fronteira fica explícita no tipo de retorno.

import { releaseProxy } from 'comlink';
import { WorkerTaskError, serializeTaskError, type SerializedTaskError } from './errors';
import { tasks as defaultTasks, type TaskContext, type TaskFn, type TaskProgress } from './tasks';

export type TaskResult<O = unknown> =
  { ok: true; value: O } | { ok: false; error: SerializedTaskError };

/** Callback de progresso; do lado do worker é um proxy Comlink (chamada assíncrona). */
export type ProgressCallback = (p: TaskProgress) => void | Promise<void>;

export interface DataWorkerApi {
  run(
    taskId: number,
    name: string,
    input: unknown,
    onProgress?: ProgressCallback,
  ): Promise<TaskResult>;
  cancel(taskId: number): void;
}

export interface DataWorkerApiOptions {
  /** Registo de tarefas; por omissão o de tasks.ts (os testes podem injetar outro). */
  tasks?: Record<string, TaskFn>;
  /** Intervalo mínimo entre mensagens de progresso (ms). */
  throttleMs?: number;
}

export const PROGRESS_THROTTLE_MS = 50;

/** Liberta a porta do proxy Comlink do callback; num callback local não faz nada. */
function release(cb: ProgressCallback): void {
  const fn = (cb as unknown as Partial<Record<typeof releaseProxy, () => void>>)[releaseProxy];
  if (typeof fn === 'function') fn();
}

/** Envia progresso no máximo 1× por `intervalMs`; o último valor pendente sai sempre no fim. */
function createProgressSender(cb: ProgressCallback | undefined, intervalMs: number) {
  let last = -Infinity;
  let pending: TaskProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (p: TaskProgress) => {
    last = Date.now();
    pending = undefined;
    // Mensagens intermédias são "fire and forget": um callback que falhe não interrompe a tarefa.
    void Promise.resolve(cb?.(p)).catch(() => undefined);
  };

  return {
    push(p: TaskProgress) {
      if (!cb) return;
      const copy: TaskProgress = { phase: p.phase, done: p.done };
      if (p.total !== undefined) copy.total = p.total;
      const wait = last + intervalMs - Date.now();
      if (wait <= 0 && timer === undefined) {
        send(copy);
        return;
      }
      pending = copy;
      timer ??= setTimeout(
        () => {
          timer = undefined;
          if (pending) send(pending);
        },
        Math.max(0, wait),
      );
    },
    /** Entrega o último progresso pendente e espera que o cliente o processe. */
    async flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const p = pending;
      pending = undefined;
      // O proxy do callback usa outro MessageChannel: aguardar garante que o progresso final
      // chega ao cliente antes da resposta de `run`.
      if (cb && p) await Promise.resolve(cb(p)).catch(() => undefined);
    },
    discard() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

export function createDataWorkerApi(options: DataWorkerApiOptions = {}): DataWorkerApi {
  const registry: Record<string, TaskFn> = options.tasks ?? defaultTasks;
  const throttleMs = options.throttleMs ?? PROGRESS_THROTTLE_MS;
  const running = new Set<number>();
  const cancelled = new Set<number>();

  return {
    async run(taskId, name, input, onProgress) {
      running.add(taskId);
      const sender = createProgressSender(onProgress, throttleMs);
      const ctx: TaskContext = {
        progress: (p) => sender.push(p),
        get cancelled() {
          return cancelled.has(taskId);
        },
        throwIfCancelled() {
          if (cancelled.has(taskId)) throw new WorkerTaskError('cancelled');
        },
      };
      try {
        const task = Object.hasOwn(registry, name) ? registry[name] : undefined;
        if (!task) throw new WorkerTaskError('failed', `Tarefa desconhecida: ${name}`);
        ctx.throwIfCancelled();
        const value: unknown = await task(input, ctx);
        await sender.flush();
        return { ok: true, value };
      } catch (err) {
        if (err instanceof WorkerTaskError && err.kind === 'cancelled') sender.discard();
        else await sender.flush();
        return { ok: false, error: serializeTaskError(err) };
      } finally {
        running.delete(taskId);
        cancelled.delete(taskId);
        if (onProgress) release(onProgress);
      }
    },

    cancel(taskId) {
      // Um cancelamento que chega depois do fim da tarefa é ignorado (não acumula ids).
      if (running.has(taskId)) cancelled.add(taskId);
    },
  };
}
