import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { colors } from '@/ui/theme/tokens';
import { AppShell } from './AppShell';

const PRIMARY = ['Home', 'Live', 'Movies', 'Series', 'Favorites'];

let media: ReturnType<typeof installMatchMedia> | undefined;

function renderAt(width: number) {
  media = installMatchMedia({ width });
  return render(
    <ThemeModeProvider>
      <AppShell>
        <p>Page content</p>
      </AppShell>
    </ThemeModeProvider>,
  );
}

const mainNav = () => screen.getByRole('navigation', { name: 'Main navigation' });
const navButtons = () => within(mainNav()).getAllByRole('button');

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
    expect(navButtons().map((b) => b.textContent)).toEqual(PRIMARY);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Settings' }));
    expect(within(mainNav()).queryByRole('button', { current: 'page' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it.each([800, 1400])('rail at %i px: five destinations plus Settings', (width) => {
    renderAt(width);
    expect(navButtons().map((b) => b.textContent)).toEqual([...PRIMARY, 'Settings']);
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

    await user.click(within(mainNav()).getByRole('button', { name: 'Settings' }));
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
    'at %i px every nav button has an accessible name and only the selected one has aria-current',
    async (width) => {
      const user = userEvent.setup();
      renderAt(width);
      for (const button of navButtons()) expect(button).toHaveAccessibleName();

      const current = within(mainNav()).getAllByRole('button', { current: 'page' });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName('Home');

      await user.click(within(mainNav()).getByRole('button', { name: 'Movies' }));
      expect(within(mainNav()).getByRole('button', { current: 'page' })).toHaveAccessibleName(
        'Movies',
      );
      expect(within(mainNav()).getByRole('button', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    },
  );

  it('page margins follow the layout breakpoints (16 / 24 / 32 px)', () => {
    renderAt(1400);
    const css = emotionCss(screen.getByRole('main'));
    expect(css).toContain('padding:16px');
    expect(css).toContain('padding:24px');
    expect(css).toContain('padding:32px');
  });

  it('renders the top bar with app name, search placeholder and children in <main>', () => {
    renderAt(1400);
    expect(within(screen.getByRole('banner')).getByText('Simple IPTV')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
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
