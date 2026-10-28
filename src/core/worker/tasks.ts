// Registo das tarefas do worker de dados — FND-07 (ADR-009).
//
// Como acrescentar uma tarefa (ex.: parseM3u, syncXtream, buildIndex):
//   1. Escrever `async function minhaTarefa(input: MeuInput, ctx: TaskContext): Promise<MeuOutput>`
//      (num ficheiro próprio em src/core/worker/tasks/ se for grande). Input e output têm de ser
//      clonáveis por structured clone (sem funções, classes ou DOM).
//   2. Chamar `ctx.progress({ phase, done, total })` à vontade (o envio é limitado a ~1/50 ms) e
//      `ctx.throwIfCancelled()` entre unidades de trabalho (ex.: a cada lote de linhas/itens).
//   3. Registá-la em `tasks` abaixo. O cliente fica tipado automaticamente:
//      `runTask('minhaTarefa', input, { onProgress, signal })`.
//   Para o cliente receber uma mensagem útil, lançar `WorkerTaskError('failed', mensagem)` — sem
//   credenciais nem URLs completos. Qualquer outro erro chega como kind 'failed' com mensagem
//   genérica (a mensagem original nunca atravessa a fronteira).

import { WorkerTaskError } from './errors';

export interface TaskProgress {
  phase: string;
  done: number;
  total?: number;
}

/** Contexto que cada tarefa recebe dentro do worker. */
export interface TaskContext {
  progress(p: TaskProgress): void;
  readonly cancelled: boolean;
  /** Lança `WorkerTaskError('cancelled')` se o cliente abortou a tarefa. */
  throwIfCancelled(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registo heterogéneo; os tipos concretos vêm de `tasks`
export type TaskFn<I = any, O = any> = (input: I, ctx: TaskContext) => Promise<O>;

export interface SelfTestInput {
  steps: number;
  /** Pausa por passo (ms). Mesmo com 0 cede o event loop para o pedido de cancelamento chegar. */
  delayMs?: number;
  /** Só para testes: lança um `WorkerTaskError('failed')` ao chegar a este passo. */
  failAt?: number;
}

export interface SelfTestOutput {
  steps: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Tarefa de demonstração: valida progresso, cancelamento e propagação de erros. */
export async function selfTest(input: SelfTestInput, ctx: TaskContext): Promise<SelfTestOutput> {
  const steps = Math.max(0, Math.floor(input.steps));
  for (let i = 0; i < steps; i++) {
    ctx.throwIfCancelled();
    if (input.failAt === i) throw new WorkerTaskError('failed', `Falha simulada no passo ${i}`);
    await pause(input.delayMs ?? 0);
    ctx.progress({ phase: 'selfTest', done: i + 1, total: steps });
  }
  ctx.throwIfCancelled();
  return { steps };
}

export const tasks = {
  selfTest,
} satisfies Record<string, TaskFn>;

export type TaskName = keyof typeof tasks;
export type TaskInput<N extends TaskName> = Parameters<(typeof tasks)[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<(typeof tasks)[N]>>;
