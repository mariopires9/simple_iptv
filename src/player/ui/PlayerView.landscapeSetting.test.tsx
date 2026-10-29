// UX-04 AC1 (Settings › Playback): the stored "Fullscreen in landscape" setting drives PlayerView's
// rotation prompt (PLY-03 AC3) when no explicit prop is given.
import 'fake-indexeddb/auto';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { installFullscreenApi, installOrientationQuery } from './test-utils/fakeDisplay';
import { LIVE, MOBILE, flush, renderPlayer } from './test-utils/renderPlayer';
import { resetFullscreenOnLandscapeSettingForTests } from './useFullscreenOnLandscapeSetting';

const restores: Array<() => void> = [];
afterEach(async () => {
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  while (restores.length > 0) restores.pop()?.();
  resetFullscreenOnLandscapeSettingForTests();
  await wipeAll();
});

/** Lets the setting read (IndexedDB) settle. */
const settle = async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await flush();
};

async function rotateToLandscape() {
  restores.push(installFullscreenApi().restore);
  const q = installOrientationQuery();
  restores.push(q.restore);
  renderPlayer({ platform: MOBILE, descriptor: LIVE });
  await settle();
  act(() => q.rotate(true));
  await flush();
}

describe('PlayerView — stored "Fullscreen in landscape" setting', () => {
  it('off: rotating does not offer fullscreen', async () => {
    await settingsRepo.set('fullscreenOnLandscape', false);
    await rotateToLandscape();
    expect(screen.queryByRole('button', { name: 'Tap for fullscreen' })).toBeNull();
  });

  it('on (or never set): rotating offers fullscreen', async () => {
    await settingsRepo.set('fullscreenOnLandscape', true);
    await rotateToLandscape();
    expect(screen.getByRole('button', { name: 'Tap for fullscreen' })).toBeInTheDocument();
  });

  it('never set: the mobile default (on)', async () => {
    await rotateToLandscape();
    expect(screen.getByRole('button', { name: 'Tap for fullscreen' })).toBeInTheDocument();
  });
});
