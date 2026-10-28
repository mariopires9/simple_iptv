// @vitest-environment node
// Review finding 3: read-stream errors must never crash the test stream server.
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({ next: null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createReadStream: (...args) => {
      const override = fsMock.next;
      fsMock.next = null;
      return override ? override(actual, ...args) : actual.createReadStream(...args);
    },
  };
});

const { startTestStreamServer } = await import('./test-stream-server.mjs');

describe('test stream server read errors', () => {
  let root;
  let server;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tss-'));
    server = await startTestStreamServer({ root });
  });
  afterAll(async () => {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('answers 500 when the file disappears between stat and read', async () => {
    const file = join(root, 'vanishing.ts');
    writeFileSync(file, Buffer.alloc(1000, 0x47));
    fsMock.next = (actual, path, options) => {
      unlinkSync(path); // stat already succeeded; the file is now gone
      return actual.createReadStream(path, options);
    };
    const res = await fetch(`${server.url}/vanishing.ts`);
    expect(res.status).toBe(500);
    await res.text();
    // The server is still alive.
    writeFileSync(join(root, 'ok.ts'), Buffer.alloc(10, 1));
    expect((await fetch(`${server.url}/ok.ts`)).status).toBe(200);
  });

  it.each(['', '/slow'])(
    'aborts the response when the stream errors mid-body (%s) and keeps serving',
    async (prefix) => {
      writeFileSync(join(root, 'broken.ts'), Buffer.alloc(4096, 0x47));
      fsMock.next = () => {
        const stream = new Readable({ read() {} });
        setImmediate(() => {
          stream.emit('ready');
          stream.push(Buffer.alloc(100, 0x47));
          setImmediate(() => stream.destroy(new Error('EIO (simulated)')));
        });
        return stream;
      };
      const res = await fetch(`${server.url}${prefix}/broken.ts`);
      expect(res.status).toBe(200);
      await expect(res.arrayBuffer()).rejects.toThrow();
      expect((await fetch(`${server.url}/broken.ts`)).status).toBe(200);
    },
  );
});
