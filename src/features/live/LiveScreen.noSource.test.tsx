import 'fake-indexeddb/auto';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { renderLive } from './test-utils';

let media: { restore(): void } | undefined;

afterEach(async () => {
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  media?.restore();
  await wipeAll();
});

describe('LiveScreen — no source', () => {
  it('shows an empty state with links to onboarding and My lists', async () => {
    media = renderLive('/live').media;
    expect(
      await screen.findByRole('heading', { name: "You don't have any IPTV lists yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a list' })).toHaveAttribute('href', '/onboarding');
    expect(screen.getByRole('link', { name: 'My lists' })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Live TV' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
