// SEC-03 — parental control in Series: while locked, a restricted category's shows are left out of
// "All" and a restricted show's details (episodes, Play) need the PIN.
import 'fake-indexeddb/auto';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, categoryKey, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import {
  lockParental,
  resetParentalForTests,
  setParentalPin,
  setRestrictedCategories,
} from '@/core/session/parental';
import { t } from '@/i18n';
import type { PlayerViewProps } from '@/player/ui';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { installScrollMetrics, m3uSource, renderSeries } from './test-utils';

vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => (
    <div role="region" aria-label={`Player: ${props.title}`} />
  ),
}));

const SOURCE = 'psr';
const gate = t.parental.gate;

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'List', 1));
  await catalogRepo.replaceForSource(SOURCE, 'series', {
    categories: [
      { externalId: 'kids', name: 'Kids' },
      { externalId: 'crime', name: 'Crime' },
    ],
    items: [
      { externalId: 'toons', categoryExternalId: 'kids', name: 'Toon Show' },
      { externalId: 'heist', categoryExternalId: 'crime', name: 'Heist Show' },
    ],
  });
  await settingsRepo.set('activeSourceId', SOURCE);
});
afterAll(async () => {
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;
beforeEach(async () => {
  restoreScroll = installScrollMetrics();
  resetParentalForTests({ iterations: 1_000 });
  await setParentalPin('1234');
  await setRestrictedCategories(`${SOURCE}:series:`, [categoryKey(SOURCE, 'series', 'crime')]);
  lockParental();
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  clearProjectionCache();
  resetParentalForTests();
  await settingsRepo.remove('parentalControl');
});

describe('SEC-03 — Series', () => {
  it('leaves restricted shows out of "All"', async () => {
    media = renderSeries('/series').media;
    const g = await screen.findByRole('grid', { name: /All/ }, { timeout: 5000 });
    await within(g).findByRole('link', { name: 'Toon Show' });
    expect(within(g).getAllByRole('gridcell')).toHaveLength(1);
    expect(screen.queryByText('Heist Show')).toBeNull();
  });

  it('a restricted show needs the PIN before its details are shown', async () => {
    media = renderSeries('/series/heist').media;
    expect(await screen.findByRole('heading', { level: 1, name: gate.title })).toBeInTheDocument();
    expect(screen.queryByText('Heist Show')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: gate.unlock }));
    await userEvent.type(screen.getByLabelText(t.parental.prompt.pin), '1234');
    await userEvent.click(screen.getByRole('button', { name: t.parental.prompt.unlock }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Heist Show' })).toBeVisible();
  });
});
