// Node-only MSW setup for Vitest (QA-01). Opt-in per test file — not wired into src/test/setup.ts.
//
//   const server = createMswServer(...xtreamHandlers({ variant: 'B' }));
//   beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
//
// Override per test with `server.use(...xtreamHandlers({ error: 'http-500' }))` (prepended, so it wins).
import type { AnyHandler } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';

export function createMswServer(...handlers: AnyHandler[]): SetupServer {
  return setupServer(...handlers);
}
