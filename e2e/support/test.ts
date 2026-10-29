// Shared Playwright fixtures (QA-02): every test runs inside the network sandbox, and fails if the
// app tried to reach a host outside it (docs/TEST_PLAN.md §2, "no requests to unexpected domains").
import { test as base, expect } from '@playwright/test';
import { installNetworkSandbox, type NetworkSandbox } from './network';

export const test = base.extend<{ sandbox: NetworkSandbox }>({
  sandbox: [
    async ({ context, baseURL }, use) => {
      const appOrigin = new URL(baseURL ?? 'http://localhost:4173/').origin;
      const sandbox = await installNetworkSandbox(context, { appOrigin });
      await use(sandbox);
      expect(sandbox.blocked, 'requests to hosts outside the E2E sandbox').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
