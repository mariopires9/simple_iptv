// PWA-04 AC1: adding a list (and testing its connection) is blocked while the browser reports no
// network, with an explanation; nothing is saved and no request is made.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from '@/core/net';
import { t } from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { M3uUrlForm } from './m3u/M3uUrlForm';
import { XtreamSourceForm } from './xtream/XtreamSourceForm';

afterEach(() => {
  vi.restoreAllMocks();
  connectivity.retry();
});

function goOffline() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
}

function renderInRouter(element: ReactNode) {
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return userEvent.setup();
}

const offline = t.state.errors.net.offline;

describe('adding a list while offline', () => {
  it('Xtream: no connection test, the offline explanation instead', async () => {
    const testConnection = vi.fn();
    const saveSource = vi.fn();
    const user = renderInRouter(
      <XtreamSourceForm doneTo="/" deps={{ testConnection, saveSource }} />,
    );
    goOffline();
    await user.type(
      screen.getByLabelText(t.sources.fields.server, { exact: false }),
      'http://panel.example.test',
    );
    await user.type(screen.getByLabelText(t.sources.fields.username, { exact: false }), 'jdoe');
    await user.type(
      screen.getByLabelText(t.sources.fields.password, { exact: false, selector: 'input' }),
      'testpass',
    );
    await user.click(screen.getByRole('button', { name: t.sources.submit }));

    expect(await screen.findByText(offline.title)).toBeInTheDocument();
    expect(screen.getByText(offline.message)).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
    expect(saveSource).not.toHaveBeenCalled();
  });

  it('M3U URL: the list is not saved, the offline explanation instead', async () => {
    const saveSource = vi.fn();
    const runImport = vi.fn();
    const user = renderInRouter(
      <M3uUrlForm doneTo="/" xtreamTo="/x" fileTo="/f" deps={{ saveSource, runImport }} />,
    );
    goOffline();
    await user.type(
      screen.getByLabelText(t.sources.addM3uUrl.fields.url, { exact: false }),
      'https://lists.example.test/list.m3u',
    );
    await user.click(screen.getByRole('button', { name: t.sources.addM3uUrl.submit }));

    expect(await screen.findByText(offline.title)).toBeInTheDocument();
    expect(saveSource).not.toHaveBeenCalled();
    expect(runImport).not.toHaveBeenCalled();
  });
});
