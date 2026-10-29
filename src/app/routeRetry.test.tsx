// TEC-01 review: a route whose strings fail to load shows the route error, and "Try again" really
// retries (React Router 8 drops a rejected function-form `lazy` from its cache; `lazyScreen`
// starts both loads again on every call).
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { ensureMessages, t } from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { AppRouter, appRoutes } from './router';

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>();
  return { ...actual, ensureMessages: vi.fn(actual.ensureMessages) };
});

let media: ReturnType<typeof installMatchMedia> | undefined;

afterEach(async () => {
  media?.restore();
  media = undefined;
  await wipeAll();
});

describe('route strings — failed load', () => {
  it('shows the route error, and "Try again" loads the strings and the screen', async () => {
    vi.mocked(ensureMessages).mockRejectedValueOnce(new Error('strings unavailable'));
    media = installMatchMedia({ width: 1400 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/onboarding'] });
    render(
      <ThemeModeProvider>
        <ToastProvider>
          <AppRouter router={router} />
        </ToastProvider>
      </ThemeModeProvider>,
    );
    expect(await screen.findByText(t.routes.error.message)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.state.actions.retry }));
    expect(
      await screen.findByRole('heading', { level: 1, name: t.onboarding.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.routes.error.message)).toBeNull();
    const onboardingLoads = vi
      .mocked(ensureMessages)
      .mock.calls.filter((call) => (call as unknown[]).includes('onboarding'));
    expect(onboardingLoads).toHaveLength(2);
  });
});
