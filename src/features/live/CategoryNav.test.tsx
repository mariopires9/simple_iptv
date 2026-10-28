import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeModeProvider } from '@/ui/theme';
import { buildCategories } from './categories';
import { CategoryNav } from './CategoryNav';

const categories = buildCategories(
  Array.from({ length: 12 }, (_, i) => ({
    key: `s:live:cat:${i}`,
    sourceId: 's',
    type: 'live' as const,
    externalId: String(i),
    name: `Category ${i}`,
    order: i,
  })),
);

function Nav({ variant }: { variant: 'chips' | 'list' }) {
  const { categoryId = '' } = useParams();
  return <CategoryNav categories={categories} selectedId={categoryId} variant={variant} />;
}

function renderNav(selectedId: string, variant: 'chips' | 'list') {
  const router = createMemoryRouter(
    [{ path: '/live/category/:categoryId', element: <Nav variant={variant} /> }],
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
});
