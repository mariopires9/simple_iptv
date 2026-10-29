import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { claimPlayback, resetPlaybackForTests } from '@/core/session';
import { t } from '@/i18n';
import { ToastProvider } from '@/ui/state';
import {
  registerServiceWorker,
  resetServiceWorkerForTests,
  swPage,
  type RegisterServiceWorker,
} from './serviceWorker';
import { UpdatePrompt } from './UpdatePrompt';

let options: RegisterSWOptions = {};
const update = vi.fn((_reload?: boolean) => Promise.resolve());

beforeEach(async () => {
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  vi.spyOn(swPage, 'reload').mockImplementation(() => {});
  const register: RegisterServiceWorker = (o) => {
    options = o;
    return update;
  };
  await registerServiceWorker(() => Promise.resolve(register));
});

afterEach(() => {
  resetServiceWorkerForTests();
  resetPlaybackForTests();
  update.mockClear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const newVersion = () => act(() => options.onNeedRefresh?.());
const renderPrompt = () =>
  render(
    <ToastProvider>
      <UpdatePrompt />
    </ToastProvider>,
  );
const updateButton = () => screen.queryByRole('button', { name: t.app.update.action });

describe('UpdatePrompt (PWA-03)', () => {
  it('shows nothing until a new version is detected', () => {
    renderPrompt();
    expect(updateButton()).not.toBeInTheDocument();
  });

  it('AC1: "New version available — Update", kept until acted on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPrompt();
      newVersion();
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(t.app.update.available);
      act(() => vi.advanceTimersByTime(60_000));
      expect(updateButton()).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC3: "Update" activates the new version (SKIP_WAITING + reload on takeover)', async () => {
    renderPrompt();
    newVersion();
    await userEvent.click(updateButton()!);
    expect(update).toHaveBeenCalledWith(true);
  });

  it('AC2: never offered while a player is open; offered again once it closes', async () => {
    renderPrompt();
    let release = () => {};
    act(() => {
      release = claimPlayback();
    });
    newVersion();
    expect(updateButton()).not.toBeInTheDocument();

    act(() => release());
    expect(await screen.findByRole('button', { name: t.app.update.action })).toBeInTheDocument();

    // Playback starts again while it is offered: withdrawn.
    act(() => {
      claimPlayback();
    });
    await vi.waitFor(() => expect(updateButton()).not.toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
  });
});
