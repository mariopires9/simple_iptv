// @vitest-environment node
// UX-04 AC2: the open-source licenses list is generated at build time from the production
// dependencies (build/licenses.ts).
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { Connect, ResolvedConfig, ViteDevServer } from 'vite';
import {
  LICENSES_FILE_NAME,
  licensesFile,
  licensesPlugin,
  productionLicenses,
  type LicensesFile,
} from '../../build/licenses.ts';
import { LICENSES_FILE_NAME as CLIENT_FILE_NAME } from '../features/settings/licenses';

const lockfile = new URL('../../package-lock.json', import.meta.url);
const realLock = JSON.parse(readFileSync(lockfile, 'utf8')) as unknown;
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const LOCK = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'simple-iptv', version: '0.0.0' },
    'node_modules/b-lib': { version: '2.0.0', license: 'MIT' },
    'node_modules/a-lib': { version: '1.0.0', license: '(MIT OR Apache-2.0)' },
    'node_modules/a-lib/node_modules/c-lib': { version: '3.0.0' },
    'node_modules/x/node_modules/b-lib': { version: '2.0.0', license: 'MIT' },
    'node_modules/@scope/d': { version: '4.0.0', license: 'ISC' },
    'node_modules/vitest': { version: '5.0.0', license: 'MIT', dev: true },
    'node_modules/typescript': { version: '6.0.0', license: 'Apache-2.0', devOptional: true },
    'node_modules/linked': { link: true },
    'node_modules/extra': { version: '1.0.0', license: 'MIT', extraneous: true },
  },
};

describe('productionLicenses', () => {
  it('lists production packages by name, deduplicated, without dev/devOptional/link/extraneous', () => {
    expect(productionLicenses(LOCK)).toEqual([
      { name: '@scope/d', version: '4.0.0', license: 'ISC' },
      { name: 'a-lib', version: '1.0.0', license: '(MIT OR Apache-2.0)' },
      { name: 'b-lib', version: '2.0.0', license: 'MIT' },
      { name: 'c-lib', version: '3.0.0', license: 'UNKNOWN' },
    ]);
  });

  it('rejects a lockfile without a packages map', () => {
    expect(() => productionLicenses({ lockfileVersion: 1, dependencies: {} })).toThrow(/packages/);
    expect(() => productionLicenses(null)).toThrow();
  });

  it('on the real lockfile: every runtime dependency, no dev tooling, every license known', () => {
    const list = productionLicenses(realLock);
    const names = new Set(list.map((entry) => entry.name));
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      expect(list).toContainEqual(expect.objectContaining({ name, version }));
    }
    // Dev tooling is never listed (a dev dependency can still be listed when a runtime package
    // depends on it too, as `npm ls --omit=dev` does: e.g. @types/react through @mui).
    for (const name of ['vite', 'vitest', 'eslint', 'typescript', 'prettier', 'jsdom']) {
      expect(pkg.devDependencies[name]).toBeDefined();
      expect(names.has(name)).toBe(false);
    }
    expect(list.filter((entry) => entry.license === 'UNKNOWN')).toEqual([]);
  });
});

describe('licensesPlugin', () => {
  it('emits licenses.json (the file the About screen fetches) in the build', () => {
    const plugin = licensesPlugin({ lockfile: lockfile.pathname });
    const emitFile = vi.fn();
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile });
    expect(LICENSES_FILE_NAME).toBe(CLIENT_FILE_NAME);
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'licenses.json',
      source: licensesFile(realLock),
    });
    const file = JSON.parse(String(emitFile.mock.calls[0]?.[0].source)) as LicensesFile;
    expect(file.version).toBe(1);
    expect(file.packages.length).toBeGreaterThan(Object.keys(pkg.dependencies).length);
  });

  it('defaults to <root>/package-lock.json', () => {
    const plugin = licensesPlugin();
    const root = new URL('../..', import.meta.url).pathname;
    (plugin.configResolved as (config: Pick<ResolvedConfig, 'root'>) => void)({ root });
    const emitFile = vi.fn();
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile });
    expect(emitFile.mock.calls[0]?.[0].source).toBe(licensesFile(realLock));
  });

  it('serves it from the dev server under the base path', () => {
    const plugin = licensesPlugin({ lockfile: lockfile.pathname });
    let middleware: Connect.NextHandleFunction | undefined;
    const server = {
      config: { base: '/simple_iptv/' },
      middlewares: { use: (fn: Connect.NextHandleFunction) => (middleware = fn) },
    } as unknown as ViteDevServer;
    (plugin.configureServer as (server: ViteDevServer) => void)(server);

    const response = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    const call = (url: string) =>
      middleware?.({ url } as IncomingMessage, response as unknown as ServerResponse, next);
    call('/simple_iptv/licenses.json?t=1');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(response.end).toHaveBeenCalledWith(licensesFile(realLock));
    call('/simple_iptv/other.json');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
