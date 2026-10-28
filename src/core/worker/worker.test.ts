// @vitest-environment node
// End-to-end tests of the data worker through Comlink, with a real MessageChannel instead of
// a Worker (FND-07 AC1 and AC2). AC3 (separate chunk) is verified by `npm run build`.
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

describe('data worker — progress (AC1)', () => {
  it('selfTest returns the result and reports progress up to the final step', async () => {
    const api = connect();
    const seen: TaskProgress[] = [];
    const out = await runTaskOn(api, 'selfTest', { steps: 5 }, { onProgress: (p) => seen.push(p) });

    expect(out).toEqual({ steps: 5 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ phase: 'selfTest', done: 5, total: 5 });
    expect(seen.every((p) => p.phase === 'selfTest' && p.total === 5)).toBe(true);
  });

  it('works without a progress callback', async () => {
    expect(await runTaskOn(connect(), 'selfTest', { steps: 3 })).toEqual({ steps: 3 });
  });

  it('throttles progress to ~1 message per 50 ms and always delivers the final one', async () => {
    const api = connect({
      tasks: {
        burst: async (_input: unknown, ctx) => {
          for (let i = 1; i <= 1000; i++) ctx.progress({ phase: 'burst', done: i, total: 1000 });
          return 'ok';
        },
      },
    });
    const seen: TaskProgress[] = [];
    await runTaskOn(api, 'burst' as TaskName, { steps: 0 }, { onProgress: (p) => seen.push(p) });

    // 1000 synchronous calls → the first goes out at once, the rest stays pending until the final flush.
    expect(seen).toEqual([
      { phase: 'burst', done: 1, total: 1000 },
      { phase: 'burst', done: 1000, total: 1000 },
    ]);
  });

  it('spreads messages over time in long tasks', async () => {
    const api = connect({
      tasks: {
        slow: async (_input: unknown, ctx) => {
          for (let i = 1; i <= 30; i++) {
            ctx.progress({ phase: 'slow', done: i });
            await pause(10);
          }
          return 'ok';
        },
      },
    });
    const seen: TaskProgress[] = [];
    const start = Date.now();
    await runTaskOn(api, 'slow' as TaskName, { steps: 0 }, { onProgress: (p) => seen.push(p) });
    const elapsed = Date.now() - start;

    // ≥ 300 ms of work with 30 updates → at most 1 message per 50 ms (+1 initial and
    // +1 final); the limit is relative to real time so it does not fail on slow machines.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.length).toBeLessThan(30);
    expect(seen.length).toBeLessThanOrEqual(Math.floor(elapsed / 50) + 2);
    expect(seen.at(-1)).toEqual({ phase: 'slow', done: 30 });
    const dones = seen.map((p) => p.done);
    expect([...dones].sort((a, b) => a - b)).toEqual(dones);
  });
});

describe('data worker — final progress already in flight (CI regression)', () => {
  it('delivers a progress message sent immediately before the task returns', async () => {
    // The first update is never throttled, so it is sent "fire and forget"; `flush` must still wait
    // for it, otherwise `run` can answer first and the client drops the late update.
    const api = connect({
      tasks: {
        once: async (_input: unknown, ctx) => {
          ctx.progress({ phase: 'once', done: 1 });
          return 'ok';
        },
      },
    });
    for (let i = 0; i < 25; i++) {
      const seen: TaskProgress[] = [];
      await runTaskOn(api, 'once' as TaskName, { steps: 0 }, { onProgress: (p) => seen.push(p) });
      expect(seen).toEqual([{ phase: 'once', done: 1 }]);
    }
  });
});

describe('data worker — cancellation (AC1)', () => {
  it('aborting the AbortSignal cancels the task with kind "cancelled"', async () => {
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

  it('an already aborted signal rejects without calling the worker', async () => {
    const run = vi.fn();
    const api = { run, cancel: vi.fn() } as unknown as DataWorkerRemote;
    const err = await rejection(
      runTaskOn(api, 'selfTest', { steps: 1 }, { signal: AbortSignal.abort() }),
    );
    expect(err.kind).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('a task that ignores cancellation has its result discarded', async () => {
    const api = connect({
      tasks: {
        deaf: async () => {
          await pause(30);
          return 'done';
        },
      },
    });
    const ctrl = new AbortController();
    const run = runTaskOn(api, 'deaf' as TaskName, { steps: 0 }, { signal: ctrl.signal });
    ctrl.abort();
    expect((await rejection(run)).kind).toBe('cancelled');
  });

  it('concurrent tasks do not interfere (cancelling one does not affect the other)', async () => {
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

describe('data worker — errors (AC2)', () => {
  it('an error in the task arrives as WorkerTaskError kind "failed" with the message', async () => {
    const err = await rejection(runTaskOn(connect(), 'selfTest', { steps: 5, failAt: 2 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Simulated failure at step 2');
  });

  it('only name/kind/message cross the boundary (no stack, cause or extra properties)', async () => {
    function explodingTask(): never {
      const e = new Error('http://u:SECRET-123@example.com refused');
      Object.assign(e, { password: 'SECRET-123' });
      const err = new WorkerTaskError('failed', 'server refused');
      Object.assign(err, { cause: e, url: 'http://u:SECRET-123@example.com' });
      throw err;
    }
    const api = connect({ tasks: { boom: async () => explodingTask() } });

    // Envelope as it arrives over the channel.
    const raw = await api.run(1, 'boom', null);
    expect(raw).toEqual({
      ok: false,
      error: { name: 'WorkerTaskError', kind: 'failed', message: 'server refused' },
    });
    expect(Object.keys(raw.ok ? {} : raw.error).sort()).toEqual(['kind', 'message', 'name']);
    expect(JSON.stringify(raw)).not.toMatch(/SECRET|explodingTask|api\.ts|at /);

    // Error recreated on the client.
    const err = await rejection(runTaskOn(api, 'boom' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('server refused');
    expect(err.cause).toBeUndefined();
    expect(Object.keys(err).sort()).toEqual(['kind', 'name']);
    expect(err.stack ?? '').not.toContain('explodingTask');
  });

  it('the message of errors that are not WorkerTaskError never crosses (review #1)', async () => {
    const api = connect({
      tasks: {
        json: async () => JSON.parse('{"password":"SECRET-123"') as unknown,
        plain: async () => {
          throw new Error('GET http://u:SECRET-123@example.com failed');
        },
        dom: async () => {
          throw new DOMException('key SECRET-123 missing', 'NotFoundError');
        },
      },
    });

    const json = await rejection(runTaskOn(api, 'json' as TaskName, { steps: 0 }));
    expect(json.kind).toBe('failed');
    expect(json.message).toBe('Worker task failed (SyntaxError)');

    const plain = await rejection(runTaskOn(api, 'plain' as TaskName, { steps: 0 }));
    expect(plain.message).toBe('Worker task failed');

    // Name not on the allowlist: not even the name passes.
    const dom = await rejection(runTaskOn(api, 'dom' as TaskName, { steps: 0 }));
    expect(dom.message).toBe('Worker task failed');

    expect(serializeTaskError(new DOMException('x SECRET', 'QuotaExceededError'))).toEqual({
      name: 'WorkerTaskError',
      kind: 'failed',
      message: 'Worker task failed (QuotaExceededError)',
    });
  });

  it('thrown values that are not Error result in a generic message', async () => {
    const api = connect({
      tasks: {
        weird: async () => {
          throw { password: 'SECRET', name: 'SECRET' };
        },
      },
    });
    const err = await rejection(runTaskOn(api, 'weird' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Worker task failed');
  });

  it('unknown task fails with kind "failed"', async () => {
    const err = await rejection(runTaskOn(connect(), 'doesNotExist' as TaskName, { steps: 0 }));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Unknown task: doesNotExist');
  });

  it('non-cloneable input fails with kind "failed" without exposing the original error', async () => {
    const input = { steps: 1, f: () => 'x' } as unknown as { steps: number };
    const err = await rejection(runTaskOn(connect(), 'selfTest', input));
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Task data cannot be transferred to the worker');
  });

  it('serialization and deserialization tolerate unexpected shapes', () => {
    expect(serializeTaskError(new WorkerTaskError('cancelled'))).toEqual({
      name: 'WorkerTaskError',
      kind: 'cancelled',
      message: 'Task cancelled',
    });
    expect(serializeTaskError(new Error(''))).toMatchObject({ kind: 'failed' });
    const d = deserializeTaskError({ kind: 'other', message: 42, stack: 'x' });
    expect(d).toBeInstanceOf(WorkerTaskError);
    expect(d.kind).toBe('failed');
    expect(d.message).toBe('Worker task failed');
    expect(deserializeTaskError(null).kind).toBe('failed');
  });
});

describe('data worker — cancellation in the worker (review #7)', () => {
  it('an error thrown after cancellation is reported as "cancelled"', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = createDataWorkerApi({
      tasks: {
        stubborn: async () => {
          await gate;
          throw new Error('blew up while cleaning up');
        },
      },
    });
    const run = api.run(7, 'stubborn', null);
    api.cancel(7);
    release();
    expect(await run).toEqual({
      ok: false,
      error: { name: 'WorkerTaskError', kind: 'cancelled', message: 'Task cancelled' },
    });
  });

  it('an AbortError (e.g. aborted inner fetch) is reported as "cancelled"', async () => {
    const api = createDataWorkerApi({
      tasks: {
        network: async () => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        },
      },
    });
    expect(await api.run(8, 'network', null)).toMatchObject({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});

describe('data worker — time-bounded final progress (review #6)', () => {
  it('run responds even if the client never acknowledges the final progress', async () => {
    const api = createDataWorkerApi({ throttleMs: 1000, flushTimeoutMs: 30 });
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    // Nobody listens on port1: the callback acknowledgement never arrives.
    const start = Date.now();
    const result = await api.run(9, 'selfTest', { steps: 3 }, port2);
    expect(result).toEqual({ ok: true, value: { steps: 3 } });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('client — immediate abort (review #3 and #4)', () => {
  it('aborting rejects immediately, sends cancel to the worker and cuts off progress', async () => {
    const api = connect({
      tasks: {
        deaf: async (_input: unknown, ctx) => {
          // Ignores cancellation and keeps emitting progress for ~300 ms.
          for (let i = 1; i <= 30; i++) {
            ctx.progress({ phase: 'deaf', done: i });
            await pause(10);
          }
          return 'done';
        },
      },
      throttleMs: 0,
    });
    const ctrl = new AbortController();
    const seen: TaskProgress[] = [];
    const run = runTaskOn(
      api,
      'deaf' as TaskName,
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

  it('sends api.cancel(taskId) to the worker even when rejecting immediately', async () => {
    const cancel = vi.fn(async (_id: number) => undefined);
    const run = vi.fn((_id: number) => new Promise<never>(() => {}));
    const api = { run, cancel } as unknown as DataWorkerRemote;
    const ctrl = new AbortController();
    const p = runTaskOn(api, 'selfTest', { steps: 1 }, { signal: ctrl.signal });
    ctrl.abort();
    expect((await rejection(p)).kind).toBe('cancelled');
    expect(cancel).toHaveBeenCalledWith(run.mock.calls[0]?.[0]);
  });

  it('if the user aborted, "cancelled" wins over a task failure', async () => {
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

describe('client — progress port always closed (review #5)', () => {
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

  it('closes the port when the input is not cloneable', async () => {
    const api = connect();
    const closed = trackChannels();
    const input = { steps: 1, f: () => 'x' } as unknown as { steps: number };
    await rejection(runTaskOn(api, 'selfTest', input, { onProgress: () => {} }));
    expect(closed).toEqual([true]);
  });

  it('closes the port on success and when the transport fails', async () => {
    const api = connect();
    const closed = trackChannels();
    await runTaskOn(api, 'selfTest', { steps: 2 }, { onProgress: () => {} });
    const broken = {
      run: vi.fn(async () => {
        throw new Error('broken channel');
      }),
      cancel: vi.fn(),
    } as unknown as DataWorkerRemote;
    const err = await rejection(
      runTaskOn(broken, 'selfTest', { steps: 1 }, { onProgress: () => {} }),
    );
    expect(err.message).toBe('Communication with the worker failed');
    expect(closed).toEqual([true, true]);
  });
});

describe('data worker client', () => {
  const created: Array<{ url: string; options: WorkerOptions | undefined; worker: EventTarget }> =
    [];
  const terminate = vi.fn();
  class FakeWorker extends EventTarget {
    constructor(url: URL | string, options?: WorkerOptions) {
      super();
      created.push({ url: String(url), options, worker: this });
    }
    // Never replies: calls stay in flight until the worker fails or is terminated.
    postMessage() {}
    terminate = terminate;
  }

  function stubWorker() {
    created.length = 0;
    terminate.mockClear();
    vi.stubGlobal('Worker', FakeWorker);
  }

  it('lazily creates a single module Worker and terminates it', () => {
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
    'a "%s" event rejects in-flight calls and recreates the worker (review #2)',
    async (type) => {
      stubWorker();
      const a = runTask('selfTest', { steps: 1 });
      const b = runTask('selfTest', { steps: 2 });
      created[0]?.worker.dispatchEvent(new Event(type));

      for (const err of [await rejection(a), await rejection(b)]) {
        expect(err.kind).toBe('failed');
        expect(err.message).toBe('The data worker failed');
      }
      expect(terminate).toHaveBeenCalledOnce();
      getDataWorker();
      expect(created).toHaveLength(2);
    },
  );

  it('terminateDataWorker rejects in-flight calls (review #2)', async () => {
    stubWorker();
    const a = runTask('selfTest', { steps: 1 });
    terminateDataWorker();
    const err = await rejection(a);
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('The data worker was terminated');
  });
});
