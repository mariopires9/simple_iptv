// UX-04 AC1–AC3 — Settings › About: version, licenses generated at build time (loaded only when
// opened) and the legal notice.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import packageJson from '../../../../package.json';
import type { LicenseEntry } from '../licenses';
import { renderSettings } from '../test-utils';
import { AboutSection } from './AboutSection';

const text = t.settings.about;
const PACKAGES: LicenseEntry[] = [
  { name: 'react', version: '19.3.1', license: 'MIT' },
  { name: 'hls.js', version: '1.7.3', license: 'Apache-2.0' },
];

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(() => media.restore());

describe('AboutSection', () => {
  it('shows the version from the build (package.json)', () => {
    renderSettings(<AboutSection load={vi.fn()} />);
    expect(screen.getByText(packageJson.version)).toBeInTheDocument();
  });

  it('AC3: shows the legal notice', () => {
    renderSettings(<AboutSection load={vi.fn()} />);
    expect(text.legal).toBe(
      'The app does not provide content; it only uses sources you are authorized to access.',
    );
    expect(screen.getByText(text.legal)).toBeInTheDocument();
  });

  it('AC2: loads the licenses list only when opened, then lists every package', async () => {
    const user = userEvent.setup();
    const load = vi.fn(() => Promise.resolve(PACKAGES));
    renderSettings(<AboutSection load={load} />);
    const toggle = screen.getByRole('button', { name: text.licenses });
    expect(load).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'react 19.3.1 · MIT',
      'hls.js 1.7.3 · Apache-2.0',
    ]);
    expect(load).toHaveBeenCalledTimes(1);

    await user.click(toggle);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('AC2: a missing list (plugin not registered) degrades to a message with a retry', async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<() => Promise<LicenseEntry[]>>()
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce(PACKAGES);
    renderSettings(<AboutSection load={load} />);
    await user.click(screen.getByRole('button', { name: text.licenses }));
    expect(await screen.findByText(text.licensesUnavailable)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.state.actions.retry }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  });
});
