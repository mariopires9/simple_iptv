// UX-04 AC2 — the client of the build-time licenses list (build/licenses.ts).
import { describe, expect, it, vi } from 'vitest';
import { loadLicenses } from './licenses';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('loadLicenses', () => {
  it('fetches licenses.json next to index.html (Vite base), without credentials', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        json({ version: 1, packages: [{ name: 'react', version: '19.3.1', license: 'MIT' }] }),
      ),
    );
    const packages = await loadLicenses(fetchImpl as unknown as typeof fetch, '/simple_iptv/');
    expect(packages).toEqual([{ name: 'react', version: '19.3.1', license: 'MIT' }]);
    expect(fetchImpl).toHaveBeenCalledWith('/simple_iptv/licenses.json', { credentials: 'omit' });
  });

  it('drops malformed entries', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        json({
          version: 1,
          packages: [{ name: 'ok', version: '1.0.0', license: 'MIT' }, { name: 1 }, null, 'x'],
        }),
      );
    expect(await loadLicenses(fetchImpl as typeof fetch, '/')).toEqual([
      { name: 'ok', version: '1.0.0', license: 'MIT' },
    ]);
  });

  it('rejects a missing file (plugin not registered) and an unknown format', async () => {
    await expect(
      loadLicenses((() => Promise.resolve(json({}, 404))) as typeof fetch, '/'),
    ).rejects.toThrow(/404/);
    await expect(
      loadLicenses(
        (() => Promise.resolve(json({ version: 2, packages: [] }))) as typeof fetch,
        '/',
      ),
    ).rejects.toThrow(/format/);
    // The dev server's SPA fallback answers with HTML.
    await expect(
      loadLicenses((() => Promise.resolve(new Response('<!doctype html>'))) as typeof fetch, '/'),
    ).rejects.toThrow();
  });
});
