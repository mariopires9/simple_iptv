// UX-07 — protected content (DRM/DASH) in Series, from an M3U list grouped at import (VOD-04):
// a show whose every episode is protected shows the badge in the grid and on its details (Play
// disabled); a mixed show marks only its protected episode rows, which never play; "Hide
// protected content" leaves fully protected shows out of the grid.
import 'fake-indexeddb/auto';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import { t } from '@/i18n';
import type { PlayerViewProps } from '@/player/ui';
import { M3uCatalogBuilder, parseM3uText } from '@/providers/m3u';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { installScrollMetrics, m3uSource, renderSeries } from './test-utils';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));

const SOURCE = 'ps';
const CDN = 'https://cdn.example.test/p';
const DRM = '#KODIPROP:inputstream.adaptive.license_type=clearkey';
const LIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="Séries",Locked Show S01E01',
  DRM,
  `${CDN}/l1.mpd`,
  '#EXTINF:-1 group-title="Séries",Locked Show S01E02',
  `${CDN}/l2.mpd`,
  '#EXTINF:-1 group-title="Séries",Mixed Show S01E01 - Open',
  `${CDN}/m1.mp4`,
  '#EXTINF:-1 group-title="Séries",Mixed Show S01E02 - Closed',
  DRM,
  `${CDN}/m2.mpd`,
].join('\n');
const LABEL = t.state.protectedContent.label;
const UNPLAYABLE = t.state.protectedContent.unplayable;
const named = (title: string) => (name: string) =>
  name.startsWith(title) && name.replace(/\s+/g, ' ').includes(LABEL);

let lockedId = '';
let mixedId = '';

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'List', 1));
  const builder = new M3uCatalogBuilder();
  for (const entry of parseM3uText(LIST).entries) builder.add(entry);
  const catalog = builder.build();
  lockedId = catalog.series.items[0]!.externalId;
  mixedId = catalog.series.items[1]!.externalId;
  await catalogRepo.replaceAllForExistingSource(SOURCE, catalog);
  await settingsRepo.set('activeSourceId', SOURCE);
});

afterAll(async () => {
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;
beforeEach(() => {
  restoreScroll = installScrollMetrics();
  views.length = 0;
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  clearProjectionCache();
  await settingsRepo.set('hideProtectedContent', false);
});

function show(path: string) {
  const view = renderSeries(path);
  media = view.media;
  return view;
}

describe('UX-07 — Series grid', () => {
  it('only the fully protected show carries the badge', async () => {
    show('/series');
    const g = await screen.findByRole('grid', { name: /^Series in/ }, { timeout: 5000 });
    expect(await within(g).findByRole('link', { name: named('Locked Show') })).toBeInTheDocument();
    const mixed = within(g).getByRole('link', { name: /^Mixed Show/ });
    expect(within(mixed).queryByTestId('protected-badge')).toBeNull();
  });

  it('"Hide protected content" leaves the fully protected show out', async () => {
    await settingsRepo.set('hideProtectedContent', true);
    show('/series');
    const g = await screen.findByRole('grid', { name: /^Series in/ }, { timeout: 5000 });
    await within(g).findByRole('link', { name: /^Mixed Show/ });
    expect(within(g).getAllByRole('gridcell')).toHaveLength(1);
    expect(within(g).queryByText('Locked Show')).toBeNull();
  });
});

describe('UX-07 — Series details', () => {
  it('a fully protected show: badge in the hero, Play disabled, rows marked, nothing plays', async () => {
    show(`/series/${lockedId}`);
    const play = await screen.findByRole('button', { name: /^Play S1 E1/ }, { timeout: 5000 });
    expect(play).toBeDisabled();
    expect(screen.getByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText(UNPLAYABLE)).toBeInTheDocument();
    const rows = screen.getAllByTestId('episode-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const button = within(row).getByRole('button');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleName(expect.stringContaining(UNPLAYABLE));
      await userEvent.click(button);
    }
    expect(views).toHaveLength(0);
  });

  it('a mixed show: no hero badge; only the protected episode row is marked and refuses to play', async () => {
    show(`/series/${mixedId}`);
    const play = await screen.findByRole('button', { name: /^Play S1 E1/ }, { timeout: 5000 });
    expect(play).toBeEnabled();
    expect(screen.queryByRole('img', { name: LABEL })).toBeNull();
    const [open, closed] = screen.getAllByTestId('episode-row');
    expect(within(open!).queryByTestId('protected-badge')).toBeNull();
    expect(within(closed!).getByTestId('protected-badge')).toBeInTheDocument();

    await userEvent.click(within(closed!).getByRole('button'));
    expect(views).toHaveLength(0);

    await userEvent.click(within(open!).getByRole('button'));
    expect(await screen.findByRole('region', { name: /Player/ })).toBeInTheDocument();
  });
});
