// @vitest-environment node
// Testes ponta a ponta do worker de dados através do Comlink, com um MessageChannel real em vez de
// um Worker (FND-07 CA1 e CA2). O CA3 (chunk separado) verifica-se no `npm run build`.
import { expose, wrap } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataWorkerApi, type DataWorkerApiOptions, type DataWorkerApi } from './api';
import {
  getDataWorker,
  runTask,
  runTaskOn,
  terminateDataWorker,
  type DataWorkerRemote,
} from './client';
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
      const e = new Error('http://u:SEGREDO-123@exemplo.com recusou');
      Object.assign(e, { password: 'SEGREDO-123' });
      const err = new WorkerTaskError('failed', 'servidor recusou');
      Object.assign(err, { cause: e, url: 'http://u:SEGREDO-123@exemplo.com' });
      throw err;
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

  it('a mensagem de erros que não são WorkerTaskError nunca atravessa (revisão #1)', async () => {
    const api = connect({
      tasks: {
        json: async () => JSON.parse('{"password":"SEGREDO-123"') as unknown,
        comum: async () => {
          throw new Error('GET http://u:SEGREDO-123@exemplo.com falhou');
        },
        dom: async () => {
          throw new DOMException('chave SEGREDO-123 em falta', 'NotFoundError');
        },
      },
    });

    const json = await rejection(runTaskOn(api, 'json' as TaskName, { steps: 0 }));
    expect(json.kind).toBe('failed');
    expect(json.message).toBe('Falha na tarefa do worker (SyntaxError)');

    const comum = await rejection(runTaskOn(api, 'comum' as TaskName, { steps: 0 }));
    expect(comum.message).toBe('Falha na tarefa do worker');

    // Nome fora da lista branca: nem o nome passa.
    const dom = await rejection(runTaskOn(api, 'dom' as TaskName, { steps: 0 }));
    expect(dom.message).toBe('Falha na tarefa do worker');

    expect(serializeTaskError(new DOMException('x SEGREDO', 'QuotaExceededError'))).toEqual({
      name: 'WorkerTaskError',
      kind: 'failed',
      message: 'Falha na tarefa do worker (QuotaExceededError)',
    });
  });

  it('valores lançados que não são Error resultam numa mensagem genérica', async () => {
    const api = connect({
      tasks: {
        estranha: async () => {
          throw { password: 'SEGREDO', name: 'SEGREDO' };
        },
      },
    });
    const err = await rejection(runTaskOn(api, 'estranha' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Falha na tarefa do worker');
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

describe('worker de dados — cancelamento no worker (revisão #7)', () => {
  it('um erro lançado depois do cancelamento é reportado como "cancelled"', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = createDataWorkerApi({
      tasks: {
        teimosa: async () => {
          await gate;
          throw new Error('rebentou ao limpar');
        },
      },
    });
    const run = api.run(7, 'teimosa', null);
    api.cancel(7);
    release();
    expect(await run).toEqual({
      ok: false,
      error: { name: 'WorkerTaskError', kind: 'cancelled', message: 'Tarefa cancelada' },
    });
  });

  it('um AbortError (ex.: fetch interno abortado) é reportado como "cancelled"', async () => {
    const api = createDataWorkerApi({
      tasks: {
        rede: async () => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        },
      },
    });
    expect(await api.run(8, 'rede', null)).toMatchObject({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});

describe('worker de dados — progresso final limitado no tempo (revisão #6)', () => {
  it('run responde mesmo que o cliente nunca confirme o progresso final', async () => {
    const api = createDataWorkerApi({ throttleMs: 1000, flushTimeoutMs: 30 });
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    // Ninguém escuta port1: a confirmação do callback nunca chega.
    const start = Date.now();
    const result = await api.run(9, 'selfTest', { steps: 3 }, port2);
    expect(result).toEqual({ ok: true, value: { steps: 3 } });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('cliente — abort imediato (revisão #3 e #4)', () => {
  it('abortar rejeita de imediato, envia cancel ao worker e corta o progresso', async () => {
    const api = connect({
      tasks: {
        surda: async (_input: unknown, ctx) => {
          // Ignora o cancelamento e continua a emitir progresso durante ~300 ms.
          for (let i = 1; i <= 30; i++) {
            ctx.progress({ phase: 'surda', done: i });
            await pause(10);
          }
          return 'feito';
        },
      },
      throttleMs: 0,
    });
    const ctrl = new AbortController();
    const seen: TaskProgress[] = [];
    const run = runTaskOn(
      api,
      'surda' as TaskName,
      { steps: 0 },
      { signal: ctrl.signal, onProgress: (p) => seen.push(p) },
    );
    await pause(40);
    const before = seen.length;
    expect(before).toBeGreaterThan(0);
    const start = Date.now();
    ctrl.abort();
    expect((await rejection(run)).kind).toBe('cancelled');
    expect(Date.now() - start).toBeLessThan(50);
    await pause(100);
    expect(seen.length).toBe(before);
  });

  it('envia api.cancel(taskId) ao worker mesmo rejeitando logo', async () => {
    const cancel = vi.fn(async (_id: number) => undefined);
    const run = vi.fn((_id: number) => new Promise<never>(() => {}));
    const api = { run, cancel } as unknown as DataWorkerRemote;
    const ctrl = new AbortController();
    const p = runTaskOn(api, 'selfTest', { steps: 1 }, { signal: ctrl.signal });
    ctrl.abort();
    expect((await rejection(p)).kind).toBe('cancelled');
    expect(cancel).toHaveBeenCalledWith(run.mock.calls[0]?.[0]);
  });

  it('se o utilizador abortou, prevalece "cancelled" sobre uma falha da tarefa', async () => {
    const ctrl = new AbortController();
    const api = {
      run: vi.fn(async () => {
        ctrl.abort();
        return { ok: false, error: { name: 'WorkerTaskError', kind: 'failed', message: 'x' } };
      }),
      cancel: vi.fn(async () => undefined),
    } as unknown as DataWorkerRemote;
    const err = await rejection(runTaskOn(api, 'selfTest', { steps: 1 }, { signal: ctrl.signal }));
    expect(err.kind).toBe('cancelled');
  });
});

describe('cliente — porta de progresso fechada sempre (revisão #5)', () => {
  function trackChannels() {
    const Real = MessageChannel;
    const closed: boolean[] = [];
    class Tracked extends Real {
      constructor() {
        super();
        const idx = closed.push(false) - 1;
        const close = this.port1.close.bind(this.port1);
        this.port1.close = () => {
          closed[idx] = true;
          close();
        };
      }
    }
    vi.stubGlobal('MessageChannel', Tracked);
    return closed;
  }

  it('fecha a porta quando o input não é clonável', async () => {
    const api = connect();
    const closed = trackChannels();
    const input = { steps: 1, f: () => 'x' } as unknown as { steps: number };
    await rejection(runTaskOn(api, 'selfTest', input, { onProgress: () => {} }));
    expect(closed).toEqual([true]);
  });

  it('fecha a porta no sucesso e quando o transporte falha', async () => {
    const api = connect();
    const closed = trackChannels();
    await runTaskOn(api, 'selfTest', { steps: 2 }, { onProgress: () => {} });
    const broken = {
      run: vi.fn(async () => {
        throw new Error('canal partido');
      }),
      cancel: vi.fn(),
    } as unknown as DataWorkerRemote;
    const err = await rejection(
      runTaskOn(broken, 'selfTest', { steps: 1 }, { onProgress: () => {} }),
    );
    expect(err.message).toBe('Falha na comunicação com o worker');
    expect(closed).toEqual([true, true]);
  });
});

describe('cliente do worker de dados', () => {
  const created: Array<{ url: string; options: WorkerOptions | undefined; worker: EventTarget }> =
    [];
  const terminate = vi.fn();
  class FakeWorker extends EventTarget {
    constructor(url: URL | string, options?: WorkerOptions) {
      super();
      created.push({ url: String(url), options, worker: this });
    }
    // Nunca responde: as chamadas ficam em curso até o worker falhar ou ser terminado.
    postMessage() {}
    terminate = terminate;
  }

  function stubWorker() {
    created.length = 0;
    terminate.mockClear();
    vi.stubGlobal('Worker', FakeWorker);
  }

  it('cria um único Worker módulo de forma preguiçosa e termina-o', () => {
    stubWorker();
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

  it.each(['error', 'messageerror'])(
    'um evento "%s" rejeita as chamadas em curso e recria o worker (revisão #2)',
    async (type) => {
      stubWorker();
      const a = runTask('selfTest', { steps: 1 });
      const b = runTask('selfTest', { steps: 2 });
      created[0]?.worker.dispatchEvent(new Event(type));

      for (const err of [await rejection(a), await rejection(b)]) {
        expect(err.kind).toBe('failed');
        expect(err.message).toBe('O worker de dados falhou');
      }
      expect(terminate).toHaveBeenCalledOnce();
      getDataWorker();
      expect(created).toHaveLength(2);
    },
  );

  it('terminateDataWorker rejeita as chamadas em curso (revisão #2)', async () => {
    stubWorker();
    const a = runTask('selfTest', { steps: 1 });
    terminateDataWorker();
    const err = await rejection(a);
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('O worker de dados foi terminado');
  });
});
