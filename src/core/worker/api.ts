// API exposta pelo worker de dados via Comlink — FND-07 (ADR-009).
// Separada de data.worker.ts para ser testável sem um Worker real (ex.: com MessageChannel).
//
// Erros: em vez de deixar o Comlink serializar a exceção (o handler "throw" por omissão envia
// também `stack`), `run` nunca rejeita — devolve um envelope `{ ok: false, error }` só com
// name/kind/message, e o cliente recria o `WorkerTaskError`. Assim não se mexe no registo global
// `Comlink.transferHandlers` e a fronteira fica explícita no tipo de retorno.
//
// Progresso: o cliente cria um MessageChannel, expõe o callback numa porta e transfere a outra;
// aqui essa porta é embrulhada com `wrap`. Como o cliente é dono do canal, fecha-o sempre no fim
// (mesmo se o worker morrer ou o input não for clonável) e a porta nunca fica pendurada.

import { releaseProxy, wrap } from 'comlink';
import { WorkerTaskError, serializeTaskError, type SerializedTaskError } from './errors';
import { tasks as defaultTasks, type TaskContext, type TaskFn, type TaskProgress } from './tasks';

export type TaskResult<O = unknown> =
  { ok: true; value: O } | { ok: false; error: SerializedTaskError };

/** Callback de progresso, exposto pelo cliente na outra ponta de `progressPort`. */
export type ProgressCallback = (p: TaskProgress) => void;

export interface DataWorkerApi {
  run(
    taskId: number,
    name: string,
    input: unknown,
    progressPort?: MessagePort,
  ): Promise<TaskResult>;
  cancel(taskId: number): void;
}

export interface DataWorkerApiOptions {
  /** Registo de tarefas; por omissão o de tasks.ts (os testes podem injetar outro). */
  tasks?: Record<string, TaskFn>;
  /** Intervalo mínimo entre mensagens de progresso (ms). */
  throttleMs?: number;
  /** Tempo máximo à espera de que o cliente confirme o progresso final (ms). */
  flushTimeoutMs?: number;
}

export const PROGRESS_THROTTLE_MS = 50;
export const PROGRESS_FLUSH_TIMEOUT_MS = 1000;

type RemoteProgress = (p: TaskProgress) => Promise<void>;

/** Envia progresso no máximo 1× por `intervalMs`; o último valor pendente sai sempre no fim. */
function createProgressSender(
  cb: RemoteProgress | undefined,
  intervalMs: number,
  flushTimeoutMs: number,
) {
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
    /**
     * Entrega o último progresso pendente e espera (no máximo `flushTimeoutMs`) que o cliente o
     * processe: o callback usa outro canal e, sem esta espera, o progresso final podia chegar
     * depois da resposta de `run`. O limite garante que `run` responde mesmo que o cliente já
     * tenha fechado o canal.
     */
    async flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const p = pending;
      pending = undefined;
      if (!cb || !p) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.resolve(cb(p)).catch(() => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, flushTimeoutMs);
        }),
      ]);
      clearTimeout(timeout);
    },
    discard() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

export function createDataWorkerApi(options: DataWorkerApiOptions = {}): DataWorkerApi {
  const registry: Record<string, TaskFn> = options.tasks ?? defaultTasks;
  const throttleMs = options.throttleMs ?? PROGRESS_THROTTLE_MS;
  const flushTimeoutMs = options.flushTimeoutMs ?? PROGRESS_FLUSH_TIMEOUT_MS;
  const running = new Set<number>();
  const cancelled = new Set<number>();

  return {
    async run(taskId, name, input, progressPort) {
      running.add(taskId);
      const remote = progressPort ? wrap<RemoteProgress>(progressPort) : undefined;
      const sender = createProgressSender(remote, throttleMs, flushTimeoutMs);
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
        // Depois de um cancelamento, qualquer erro (incluindo AbortError de um fetch interno)
        // é reportado como 'cancelled' e não como falha.
        if (cancelled.has(taskId) || isAbortError(err)) {
          sender.discard();
          return { ok: false, error: serializeTaskError(new WorkerTaskError('cancelled')) };
        }
        await sender.flush();
        return { ok: false, error: serializeTaskError(err) };
      } finally {
        running.delete(taskId);
        cancelled.delete(taskId);
        // O RELEASE é "fire and forget": se o cliente já fechou o canal fica sem resposta, o que é
        // inofensivo (a porta fecha-se com o canal e a promessa é descartada pelo GC).
        if (remote) remote[releaseProxy]();
      }
    },

    cancel(taskId) {
      // Um cancelamento que chega depois do fim da tarefa é ignorado (não acumula ids).
      if (running.has(taskId)) cancelled.add(taskId);
    },
  };
}
