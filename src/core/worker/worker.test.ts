// @vitest-environment node
// Testes ponta a ponta do worker de dados através do Comlink, com um MessageChannel real em vez de
// um Worker (FND-07 CA1 e CA2). O CA3 (chunk separado) verifica-se no `npm run build`.
import { expose, wrap } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataWorkerApi, type DataWorkerApiOptions, type DataWorkerApi } from './api';
import { getDataWorker, runTaskOn, terminateDataWorker, type DataWorkerRemote } from './client';
import { WorkerTaskError, deserializeTaskError, serializeTaskError } from './errors';
import type { TaskName, TaskProgress } from './tasks';

const ports: MessagePort[] = [];

function connect(options?: DataWorkerApiOptions): DataWorkerRemote {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  expose(createDataWorkerApi(options), port1);
  return wrap<DataWorkerApi>(port2);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function rejection(p: Promise<unknown>): Promise<WorkerTaskError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WorkerTaskError);
  return err as WorkerTaskError;
}

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
  terminateDataWorker();
  vi.unstubAllGlobals();
});

describe('worker de dados — progresso (CA1)', () => {
  it('selfTest devolve o resultado e reporta progresso até ao passo final', async () => {
    const api = connect();
    const seen: TaskProgress[] = [];
    const out = await runTaskOn(api, 'selfTest', { steps: 5 }, { onProgress: (p) => seen.push(p) });

    expect(out).toEqual({ steps: 5 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ phase: 'selfTest', done: 5, total: 5 });
    expect(seen.every((p) => p.phase === 'selfTest' && p.total === 5)).toBe(true);
  });

  it('funciona sem callback de progresso', async () => {
    expect(await runTaskOn(connect(), 'selfTest', { steps: 3 })).toEqual({ steps: 3 });
  });

  it('limita o progresso a ~1 mensagem por 50 ms e entrega sempre a final', async () => {
    const api = connect({
      tasks: {
        rajada: async (_input: unknown, ctx) => {
          for (let i = 1; i <= 1000; i++) ctx.progress({ phase: 'rajada', done: i, total: 1000 });
          return 'ok';
        },
      },
    });
    const seen: TaskProgress[] = [];
    await runTaskOn(api, 'rajada' as TaskName, { steps: 0 }, { onProgress: (p) => seen.push(p) });

    // 1000 chamadas síncronas → a primeira sai logo, o resto fica pendente até ao flush final.
    expect(seen).toEqual([
      { phase: 'rajada', done: 1, total: 1000 },
      { phase: 'rajada', done: 1000, total: 1000 },
    ]);
  });

  it('em tarefas longas espaça as mensagens ao longo do tempo', async () => {
    const api = connect({
      tasks: {
        lenta: async (_input: unknown, ctx) => {
          for (let i = 1; i <= 30; i++) {
            ctx.progress({ phase: 'lenta', done: i });
            await pause(10);
          }
          return 'ok';
        },
      },
    });
    const seen: TaskProgress[] = [];
    const start = Date.now();
    await runTaskOn(api, 'lenta' as TaskName, { steps: 0 }, { onProgress: (p) => seen.push(p) });
    const elapsed = Date.now() - start;

    // ≥ 300 ms de trabalho com 30 atualizações → no máximo 1 mensagem por 50 ms (+1 inicial e
    // +1 final); o limite é relativo ao tempo real para não falhar em máquinas lentas.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.length).toBeLessThan(30);
    expect(seen.length).toBeLessThanOrEqual(Math.floor(elapsed / 50) + 2);
    expect(seen.at(-1)).toEqual({ phase: 'lenta', done: 30 });
    const dones = seen.map((p) => p.done);
    expect([...dones].sort((a, b) => a - b)).toEqual(dones);
  });
});

describe('worker de dados — cancelamento (CA1)', () => {
  it('abortar o AbortSignal cancela a tarefa com kind "cancelled"', async () => {
    const api = connect();
    const ctrl = new AbortController();
    const seen: TaskProgress[] = [];
    const run = runTaskOn(
      api,
      'selfTest',
      { steps: 1000, delayMs: 5 },
      {
        signal: ctrl.signal,
        onProgress: (p) => {
          seen.push(p);
          if (p.done >= 3) ctrl.abort();
        },
      },
    );

    const err = await rejection(run);
    expect(err.kind).toBe('cancelled');
    expect(err.name).toBe('WorkerTaskError');
    expect(seen.at(-1)?.done ?? 0).toBeLessThan(100);
  });

  it('um signal já abortado rejeita sem chamar o worker', async () => {
    const run = vi.fn();
    const api = { run, cancel: vi.fn() } as unknown as DataWorkerRemote;
    const err = await rejection(
      runTaskOn(api, 'selfTest', { steps: 1 }, { signal: AbortSignal.abort() }),
    );
    expect(err.kind).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('uma tarefa que ignora o cancelamento tem o resultado descartado', async () => {
    const api = connect({
      tasks: {
        surda: async () => {
          await pause(30);
          return 'feito';
        },
      },
    });
    const ctrl = new AbortController();
    const run = runTaskOn(api, 'surda' as TaskName, { steps: 0 }, { signal: ctrl.signal });
    ctrl.abort();
    expect((await rejection(run)).kind).toBe('cancelled');
  });

  it('tarefas concorrentes não interferem (cancelar uma não afeta a outra)', async () => {
    const api = connect();
    const ctrlA = new AbortController();
    const seenA: TaskProgress[] = [];
    const seenB: TaskProgress[] = [];

    const a = runTaskOn(
      api,
      'selfTest',
      { steps: 500, delayMs: 2 },
      { signal: ctrlA.signal, onProgress: (p) => seenA.push(p) },
    );
    const b = runTaskOn(
      api,
      'selfTest',
      { steps: 20, delayMs: 2 },
      { signal: new AbortController().signal, onProgress: (p) => seenB.push(p) },
    );
    setTimeout(() => ctrlA.abort(), 15);

    const [ra, rb] = await Promise.allSettled([a, b]);
    expect(ra.status).toBe('rejected');
    expect(ra.status === 'rejected' && (ra.reason as WorkerTaskError).kind).toBe('cancelled');
    expect(rb).toEqual({ status: 'fulfilled', value: { steps: 20 } });
    expect(seenA.every((p) => p.total === 500)).toBe(true);
    expect(seenB.every((p) => p.total === 20)).toBe(true);
    expect(seenB.at(-1)).toEqual({ phase: 'selfTest', done: 20, total: 20 });
  });
});

describe('worker de dados — erros (CA2)', () => {
  it('um erro na tarefa chega como WorkerTaskError kind "failed" com a mensagem', async () => {
    const err = await rejection(runTaskOn(connect(), 'selfTest', { steps: 5, failAt: 2 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Falha simulada no passo 2');
  });

  it('só name/kind/message atravessam a fronteira (sem stack, cause ou propriedades extra)', async () => {
    function tarefaQueRebenta(): never {
      const e = new Error('servidor recusou');
      Object.assign(e, { password: 'SEGREDO-123', url: 'http://u:SEGREDO-123@exemplo.com' });
      throw new Error('servidor recusou', { cause: e });
    }
    const api = connect({ tasks: { boom: async () => tarefaQueRebenta() } });

    // Envelope tal como chega pelo canal.
    const raw = await api.run(1, 'boom', null);
    expect(raw).toEqual({
      ok: false,
      error: { name: 'WorkerTaskError', kind: 'failed', message: 'servidor recusou' },
    });
    expect(Object.keys(raw.ok ? {} : raw.error).sort()).toEqual(['kind', 'message', 'name']);
    expect(JSON.stringify(raw)).not.toMatch(/SEGREDO|tarefaQueRebenta|api\.ts|at /);

    // Erro recriado no cliente.
    const err = await rejection(runTaskOn(api, 'boom' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('servidor recusou');
    expect(err.cause).toBeUndefined();
    expect(Object.keys(err).sort()).toEqual(['kind', 'name']);
    expect(err.stack ?? '').not.toContain('tarefaQueRebenta');
  });

  it('valores lançados que não são Error resultam numa mensagem genérica', async () => {
    const api = connect({
      tasks: {
        estranha: async () => {
          throw { password: 'SEGREDO' };
        },
      },
    });
    const err = await rejection(runTaskOn(api, 'estranha' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).not.toContain('SEGREDO');
  });

  it('tarefa desconhecida falha com kind "failed"', async () => {
    const err = await rejection(runTaskOn(connect(), 'naoExiste' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Tarefa desconhecida: naoExiste');
  });

  it('input não clonável falha com kind "failed" sem expor o erro original', async () => {
    const input = { steps: 1, f: () => 'x' } as unknown as { steps: number };
    const err = await rejection(runTaskOn(connect(), 'selfTest', input));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Dados da tarefa não são transferíveis para o worker');
  });

  it('serialização e desserialização toleram formas inesperadas', () => {
    expect(serializeTaskError(new WorkerTaskError('cancelled'))).toEqual({
      name: 'WorkerTaskError',
      kind: 'cancelled',
      message: 'Tarefa cancelada',
    });
    expect(serializeTaskError(new Error(''))).toMatchObject({ kind: 'failed' });
    const d = deserializeTaskError({ kind: 'outro', message: 42, stack: 'x' });
    expect(d).toBeInstanceOf(WorkerTaskError);
    expect(d.kind).toBe('failed');
    expect(d.message).toBe('Falha na tarefa do worker');
    expect(deserializeTaskError(null).kind).toBe('failed');
  });
});

describe('cliente do worker de dados', () => {
  it('cria um único Worker módulo de forma preguiçosa e termina-o', () => {
    const created: Array<{ url: string; options: WorkerOptions | undefined }> = [];
    const terminate = vi.fn();
    class FakeWorker extends EventTarget {
      constructor(url: URL | string, options?: WorkerOptions) {
        super();
        created.push({ url: String(url), options });
      }
      postMessage() {}
      terminate = terminate;
    }
    vi.stubGlobal('Worker', FakeWorker);

    expect(created).toHaveLength(0);
    const a = getDataWorker();
    const b = getDataWorker();
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
    expect(created[0]?.url).toMatch(/data\.worker\.ts$/);
    expect(created[0]?.options?.type).toBe('module');

    terminateDataWorker();
    expect(terminate).toHaveBeenCalledOnce();
    getDataWorker();
    expect(created).toHaveLength(2);
  });
});
