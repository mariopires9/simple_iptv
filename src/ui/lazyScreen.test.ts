// TEC-01: a lazy route resolves only once its screen chunk *and* its feature strings have loaded.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureMessages } from '@/i18n';
import { lazyScreen } from './lazyScreen';

vi.mock('@/i18n', () => ({ ensureMessages: vi.fn(() => Promise.resolve()) }));

const ensure = vi.mocked(ensureMessages);

afterEach(() => ensure.mockClear());

function Screen() {
  return null;
}

/** Calls a route's `lazy` function (React Router passes it a context we do not use). */
const resolveLazy = (lazy: ReturnType<typeof lazyScreen>) =>
  (lazy as unknown as () => Promise<{ Component: unknown }>)();

describe('lazyScreen', () => {
  it('loads the declared namespaces in parallel with the screen chunk', async () => {
    let chunkRequested = false;
    let releaseStrings!: () => void;
    ensure.mockReturnValueOnce(new Promise<void>((resolve) => (releaseStrings = resolve)));
    const load = vi.fn(() => {
      chunkRequested = true;
      return Promise.resolve({ Screen });
    });
    let settled = false;
    const route = resolveLazy(lazyScreen(load, 'Screen', ['live', 'player'])).then((value) => {
      settled = true;
      return value;
    });
    expect(ensure).toHaveBeenCalledWith('live', 'player');
    expect(chunkRequested).toBe(true);
    // The chunk is there, the strings are not: the screen must not render yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    releaseStrings();
    await expect(route).resolves.toEqual({ Component: Screen });
  });

  it('without namespaces resolves with the chunk alone', async () => {
    const route = resolveLazy(lazyScreen(() => Promise.resolve({ Screen }), 'Screen'));
    await expect(route).resolves.toEqual({ Component: Screen });
    expect(ensure).toHaveBeenCalledWith();
  });

  it('fails (route error boundary) when the strings cannot be loaded', async () => {
    ensure.mockRejectedValueOnce(new Error('offline'));
    const route = resolveLazy(lazyScreen(() => Promise.resolve({ Screen }), 'Screen', ['movies']));
    await expect(route).rejects.toThrow('offline');
  });
});
