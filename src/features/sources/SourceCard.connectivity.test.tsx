// SRC-09: "Diagnostics" action on each list. PWA-04 AC1: "Refresh" is disabled while offline.
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Source } from '@/core/db';
import { connectivity } from '@/core/net';
import { t } from '@/i18n';
import { SourceCard } from './SourceCard';
import { makeSource, renderRoutes } from './test-utils';

let media: { restore(): void } | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  connectivity.retry();
});

function show(source: Source) {
  const noop = () => undefined;
  const view = renderRoutes(
    [
      {
        path: '/settings/sources',
        element: (
          <SourceCard
            source={source}
            active
            now={0}
            sync={undefined}
            onUse={noop}
            onRefresh={noop}
            onCancelRefresh={noop}
            onRemove={noop}
          />
        ),
      },
    ],
    '/settings/sources',
  );
  media = view.media;
  return view;
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

const actions = t.sources.myLists.actions;

describe('SourceCard', () => {
  it('links to the list’s diagnostics', () => {
    show(makeSource({ id: 'a b', kind: 'xtream', name: 'TV' }));
    expect(screen.getByRole('link', { name: actions.diagnostics })).toHaveAttribute(
      'href',
      '/settings/sources/a%20b/diagnostics',
    );
  });

  it('disables "Refresh" while offline and enables it when the connection returns', () => {
    show(makeSource({ id: 'tv', kind: 'm3u-url', name: 'TV' }));
    const refresh = screen.getByRole('button', { name: actions.refresh });
    expect(refresh).toBeEnabled();
    setOnline(false);
    expect(refresh).toBeDisabled();
    setOnline(true);
    expect(refresh).toBeEnabled();
  });
});
