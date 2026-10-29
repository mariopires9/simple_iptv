// UX-06 AC5: the account expiry (and connection counts) shown after a connection test are
// formatted with Intl for the active locale, and follow a language switch.
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '@/i18n';
import { accountLines } from './XtreamSourceForm';

afterEach(() => setLocale('en'));

const account = {
  status: 'Active',
  expiresAt: Date.UTC(2030, 0, 15, 12),
  maxConnections: 1200,
  activeConnections: 1,
  formats: [],
};

describe('accountLines — active locale', () => {
  it('formats the expiry and counts in English, then in pt-PT after a switch', async () => {
    const en = accountLines(account);
    expect(en[1]).toBe(t.sources.result.expires('January 15, 2030'));
    expect(en[2]).toBe(t.sources.result.connections('1', '1,200'));

    await setLocale('pt-PT');
    const pt = accountLines(account);
    expect(pt[1]).toBe(t.sources.result.expires('15 de janeiro de 2030'));
    expect(pt[2]).toBe(
      t.sources.result.connections('1', new Intl.NumberFormat('pt-PT').format(1200)),
    );
  });
});
