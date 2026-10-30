import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { colors } from '@/ui/theme/tokens';
import { AppShell } from './AppShell';

const PRIMARY = ['Home', 'Live', 'Movies', 'Series', 'Favorites'];

let media: ReturnType<typeof installMatchMedia> | undefined;

let router: ReturnType<typeof createMemoryRouter> | undefined;

/** The shell alone (no screens) inside a memory router: every path renders it. */
function renderAt(width: number, path = '/') {
  media = installMatchMedia({ width });
  router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppShell>
            <p>Page content</p>
          </AppShell>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
}

const mainNav = () => screen.getByRole('navigation', { name: 'Main navigation' });
const navLinks = () => within(mainNav()).getAllByRole('link');
const currentPath = () => router?.state.location.pathname;

/** The Emotion CSS rules (including @media blocks) generated for an element's classes. */
function emotionCss(element: Element): string {
  const css = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  return Array.from(element.classList)
    .filter((cls) => cls.startsWith('css-'))
    .flatMap((cls) => css.match(new RegExp(`\\.${cls}\\{[^}]*\\}`, 'g')) ?? [])
    .join('\n');
}

afterEach(async () => {
  media?.restore();
  media = undefined;
  await wipeAll();
});

// FND-03 AC3
describe('AppShell — responsive navigation', () => {
  it.each([
    [360, 'bottom'],
    [599, 'bottom'],
    [600, 'rail'],
    [900, 'rail'],
    [1199, 'rail'],
    [1200, 'expanded'],
    [1600, 'expanded'],
  ] as const)('at %i px uses the %s navigation', (width, layout) => {
    renderAt(width);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(mainNav()).toHaveAttribute('data-layout', layout);
  });

  it('mobile: bottom bar with the five destinations; Settings lives in the top bar menu', async () => {
    const user = userEvent.setup();
    renderAt(375);
    expect(navLinks().map((b) => b.textContent)).toEqual(PRIMARY);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Settings' }));
    expect(currentPath()).toBe('/settings');
    expect(within(mainNav()).queryByRole('link', { current: 'page' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it.each([800, 1400])('rail at %i px: five destinations plus Settings', (width) => {
    renderAt(width);
    expect(navLinks().map((b) => b.textContent)).toEqual([...PRIMARY, 'Settings']);
  });

  it('rail/top bar menu does not duplicate Settings on tablet and desktop', async () => {
    const user = userEvent.setup();
    renderAt(1000);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).toBeNull();
  });

  it('switches layout live when the viewport is resized', () => {
    renderAt(375);
    expect(mainNav()).toHaveAttribute('data-layout', 'bottom');
    act(() => media?.set({ width: 1300 }));
    expect(mainNav()).toHaveAttribute('data-layout', 'expanded');
  });

  it('Settings selected on the rail stays visibly selected after shrinking to the bottom bar', async () => {
    const user = userEvent.setup();
    renderAt(1000);
    const more = screen.getByRole('button', { name: 'More options' });
    expect(more).not.toHaveAttribute('data-selected');

    await user.click(within(mainNav()).getByRole('link', { name: 'Settings' }));
    act(() => media?.set({ width: 375 }));

    expect(mainNav()).toHaveAttribute('data-layout', 'bottom');
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'data-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'More options' })).toHaveStyle({
      color: colors.dark.accent,
    });
  });

  // The bar is sticky in normal flow: its real height (wrapped pt-PT labels, font scaling, iOS
  // safe-area inset) pushes the content, so nothing relies on a guessed padding.
  it('mobile: the bottom bar is in normal flow after <main>, not fixed over it', () => {
    renderAt(375);
    const nav = mainNav();
    const main = screen.getByRole('main');
    expect(nav).toHaveStyle({ position: 'sticky' });
    expect(nav).not.toHaveStyle({ position: 'fixed' });
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No bottom padding derived from a guessed bar height.
    expect(emotionCss(main)).toContain('padding:16px');
    expect(emotionCss(main)).not.toMatch(/padding-bottom/);
  });

  it('mobile: the bottom bar reserves the iOS safe-area inset', () => {
    renderAt(375);
    expect(emotionCss(mainNav())).toContain('padding-bottom:env(safe-area-inset-bottom)');
  });
});

describe('AppShell — accessibility and selection', () => {
  it.each([375, 800, 1400])(
    'at %i px every nav link has an accessible name and only the selected one has aria-current',
    async (width) => {
      const user = userEvent.setup();
      renderAt(width);
      for (const button of navLinks()) expect(button).toHaveAccessibleName();

      const current = within(mainNav()).getAllByRole('link', { current: 'page' });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName('Home');

      await user.click(within(mainNav()).getByRole('link', { name: 'Movies' }));
      expect(currentPath()).toBe('/movies');
      expect(within(mainNav()).getByRole('link', { current: 'page' })).toHaveAccessibleName(
        'Movies',
      );
      expect(within(mainNav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    },
  );

  // FND-04 AC4: the current item follows the route (deep links, nested paths, back/forward).
  it.each([
    ['/', 'Home'],
    ['/live/category/7', 'Live'],
    ['/movies/category/123', 'Movies'],
    ['/movies/42', 'Movies'],
    ['/series/9', 'Series'],
    ['/favorites', 'Favorites'],
    ['/settings', 'Settings'],
    ['/settings/sources', 'Settings'],
    ['/Movies/category/1', 'Movies'],
    ['/SETTINGS/sources', 'Settings'],
  ])('rail: at %s the current item is %s', (path, name) => {
    renderAt(1400, path);
    const current = within(mainNav()).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(name);
  });

  it.each(['/search', '/does-not-exist'])('at %s no nav item is current', (path) => {
    renderAt(1400, path);
    expect(within(mainNav()).queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('nav items are links to their routes', () => {
    renderAt(1400);
    const hrefs = navLinks().map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/live', '/movies', '/series', '/favorites', '/settings']);
  });

  it('follows programmatic navigation and history back', async () => {
    renderAt(375, '/movies');
    expect(within(mainNav()).getByRole('link', { current: 'page' })).toHaveAccessibleName('Movies');
    await act(() => router?.navigate('/settings/sources'));
    expect(within(mainNav()).queryByRole('link', { current: 'page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'data-selected',
      'true',
    );
    await act(() => router?.navigate(-1));
    expect(within(mainNav()).getByRole('link', { current: 'page' })).toHaveAccessibleName('Movies');
  });

  // UX-03 AC3: the first tab stop is a "Skip to content" link that moves focus to <main>.
  it.each([375, 1400])('at %i px the first tab stop skips to the main content', async (width) => {
    const user = userEvent.setup();
    renderAt(width, '/movies');
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    // The hash router owns the URL: the skip link does not navigate.
    expect(currentPath()).toBe('/movies');
  });

  it('page margins follow the layout breakpoints (16 / 24 / 32 px)', () => {
    renderAt(1400);
    const css = emotionCss(screen.getByRole('main'));
    expect(css).toContain('padding:16px');
    expect(css).toContain('padding:24px');
    expect(css).toContain('padding:32px');
  });

  it('renders the top bar with app name, the search link and children in <main>', () => {
    renderAt(1400);
    expect(within(screen.getByRole('banner')).getByText('Simple IPTV')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expect(within(screen.getByRole('main')).getByText('Page content')).toBeInTheDocument();
  });

  it('groups the theme options under an accessible "Theme" group inside the menu', async () => {
    const user = userEvent.setup();
    renderAt(375);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');
    const group = within(menu).getByRole('group', { name: 'Theme' });
    expect(
      within(group)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual(['System', 'Dark', 'Light']);

    // Arrow keys still reach the grouped items from the Settings item.
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(group).getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(group).getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
  });

  it('switches theme from the top bar menu', async () => {
    const user = userEvent.setup();
    renderAt(375);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(document.body).toHaveStyle({ backgroundColor: colors.light.bg });
  });
});
