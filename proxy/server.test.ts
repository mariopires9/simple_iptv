// @vitest-environment node
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './server.ts';
import { fetchRaw, listen } from './test-support.ts';

import { buildHealthUrl } from './url.ts';

const run = promisify(execFile);
const serverPath = fileURLToPath(new URL('./server.ts', import.meta.url));
const TOKEN = 'srv-token-0123456789-abcdefghijklmnopqrs';
const dir = mkdtempSync(join(tmpdir(), 'proxy-server-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('CLI', () => {
  it('parses arguments', () => {
    expect(parseArgs(['--generate-token'])).toEqual({ kind: 'generate-token' });
    expect(parseArgs(['--config', 'c.json'])).toEqual({ kind: 'run', configPath: 'c.json' });
    expect(parseArgs([]).kind).toBe('run');
    expect(parseArgs(['--config'])).toEqual({ kind: 'invalid' });
    expect(parseArgs(['--port', '1'])).toEqual({ kind: 'invalid' });
  });

  it('prints a token with plain Node 24 type stripping (no build step)', async () => {
    const { stdout } = await run(process.execPath, [serverPath, '--generate-token']);
    expect(stdout).toMatch(/^[A-Za-z0-9_-]{43}\n$/);
  });

  it('exits 1 on an invalid config without echoing it', async () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ token: 'secret-but-short', allowedOrigins: [] }));
    const error = await run(process.execPath, [serverPath, '--config', path]).catch(
      (e: unknown) => e,
    );
    expect((error as { code?: number }).code).toBe(1);
    expect(String((error as { stderr?: string }).stderr)).toMatch(/"token" must be/);
    expect(String((error as { stderr?: string }).stderr)).not.toContain('secret-but-short');
  });

  it('starts with a valid config, answers health and logs only port and counts', async () => {
    // Find a free port, then release it for the proxy.
    const probe = await listen(createServer());
    const port = probe.port;
    await probe.close();
    const path = join(dir, 'good.json');
    writeFileSync(
      path,
      JSON.stringify({
        listen: { host: '127.0.0.1', port },
        token: TOKEN,
        allowedOrigins: ['https://user.github.io'],
        upstream: { allowedHosts: ['panel.example.com', '*.example.net'] },
      }),
    );
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const running = await main(['--config', path]);
      if (typeof running === 'number') throw new Error(`exit ${running}`);
      const res = await fetchRaw(buildHealthUrl(`http://127.0.0.1:${running.port}`, TOKEN));
      expect(res.status).toBe(200);
      await running.close();
      const startup = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(startup).toMatchObject({ event: 'startup', port, allowedHosts: 2, allowedOrigins: 1 });
      expect(lines.join('\n')).not.toContain('example');
      expect(lines.join('\n')).not.toContain(TOKEN);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'shuts down gracefully on %s (exit code 0)',
    async (signal) => {
      const probe = await listen(createServer());
      const port = probe.port;
      await probe.close();
      const path = join(dir, `signal-${signal}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          listen: { port },
          token: TOKEN,
          allowedOrigins: ['https://user.github.io'],
          upstream: { allowedHosts: ['panel.example.com'] },
        }),
      );
      const child = spawn(process.execPath, [serverPath, '--config', path], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      await new Promise<void>((resolve) => {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes('"startup"')) resolve();
        });
      });
      const exit = new Promise<number | null>((resolve) =>
        child.on('exit', (code) => resolve(code)),
      );
      child.kill(signal);
      expect(await exit).toBe(0);
      expect(stdout).toContain('"shutdown"');
    },
  );
});
