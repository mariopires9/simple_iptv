// UX-07: Home/Favorites cards of protected content (DRM/DASH) carry the "Protected" badge and say
// so in their accessible name.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import type { CardItem } from './data';
import { ItemCard } from './ItemCard';

const card = (extra: Partial<CardItem> = {}): CardItem => ({
  key: 's:movie:1',
  type: 'movie',
  name: 'Film',
  href: '/movies/1',
  ...extra,
});

describe('ItemCard — protected content (UX-07)', () => {
  it('marks a protected item', () => {
    render(
      <MemoryRouter>
        <ItemCard item={card({ protected: true })} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', {
      name: (n) => n.startsWith('Film') && n.includes(t.state.protectedContent.label),
    });
    expect(within(link).getByTestId('protected-badge')).toBeInTheDocument();
  });

  it('no badge otherwise', () => {
    render(
      <MemoryRouter>
        <ItemCard item={card()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Film' })).toBeInTheDocument();
    expect(screen.queryByTestId('protected-badge')).toBeNull();
  });
});
