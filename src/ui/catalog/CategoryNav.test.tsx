import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeModeProvider } from '@/ui/theme';
import { CategoryNav, type NavCategory } from './CategoryNav';

const categories: NavCategory[] = [
  { id: '~favorites', name: 'Favourites', favorite: true },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    name: `Category ${i}`,
  })),
];

const pathFor = (id: string) => `/live/category/${encodeURIComponent(id)}`;

function Nav({ variant, search }: { variant: 'chips' | 'list'; search?: string }) {
  const { categoryId = '' } = useParams();
  return (
    <CategoryNav
      categories={categories}
      selectedId={categoryId}
      variant={variant}
      label="Categories"
      pathFor={pathFor}
      {...(search !== undefined && { search })}
    />
  );
}

function renderNav(selectedId: string, variant: 'chips' | 'list', search?: string) {
  const router = createMemoryRouter(
    [{ path: '/live/category/:categoryId', element: <Nav variant={variant} search={search} /> }],
    { initialEntries: [`/live/category/${selectedId}`] },
  );
  const view = render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return { ...view, router };
}

const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

afterEach(() => {
  if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
  else delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('CategoryNav', () => {
  it('scrolls the selected chip into view on mount and on selection change (mobile)', async () => {
    const calls: [string | null, ScrollIntoViewOptions | boolean | undefined][] = [];
    Element.prototype.scrollIntoView = vi.fn(function (
      this: Element,
      arg?: ScrollIntoViewOptions | boolean,
    ) {
      calls.push([this.textContent, arg]);
    });
    const { router } = renderNav('9', 'chips');
    expect(calls).toEqual([['Category 9', { inline: 'center', block: 'nearest' }]]);

    await act(() => router.navigate('/live/category/3'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toBe('Category 3');
  });

  it('works without scrollIntoView (jsdom) and does not scroll the side list', () => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    expect(() => renderNav('9', 'chips')).not.toThrow();
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderNav('9', 'list');
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['chips', 'list'] as const)(
    'links each category to its feature path, keeps the query and marks the selection (%s)',
    (variant) => {
      renderNav('3', variant, '?channel=k');
      const nav = screen.getByRole('navigation', { name: 'Categories' });
      const links = within(nav).getAllByRole('link');
      expect(links).toHaveLength(13);
      expect(links[4]).toHaveAttribute('href', '/live/category/3?channel=k');
      expect(links[4]).toHaveAttribute('aria-current', 'page');
      expect(links[0]).not.toHaveAttribute('aria-current');
      // Only the favourites category has an icon.
      expect(links[0]?.querySelector('svg')).not.toBeNull();
      expect(links[1]?.querySelector('svg')).toBeNull();
    },
  );
});
