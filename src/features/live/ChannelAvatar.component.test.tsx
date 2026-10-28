import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeModeProvider } from '@/ui/theme';
import { ChannelAvatar } from './ChannelAvatar';

const avatar = (logo: string | undefined) => (
  <ThemeModeProvider>
    <ChannelAvatar name="Channel One" logo={logo} />
  </ThemeModeProvider>
);

describe('ChannelAvatar', () => {
  it('falls back to initials when the logo fails, and retries when the logo changes', () => {
    const view = render(avatar('https://logos.example/a.png'));
    const img = view.container.querySelector('img');
    if (!img) throw new Error('no img');
    fireEvent.error(img);
    expect(screen.getByTestId('channel-initials')).toHaveTextContent('CO');

    // A recycled row (or a sync) gives it another logo: that one is tried.
    view.rerender(avatar('https://logos.example/b.png'));
    expect(view.container.querySelector('img')).toHaveAttribute(
      'src',
      'https://logos.example/b.png',
    );
    expect(screen.queryByTestId('channel-initials')).toBeNull();
  });
});
