// SEC-03 — parental control store: a 4–8 digit PIN kept only as a salted PBKDF2/SHA-256 hash,
// restricted categories, a per-session unlock, and change/remove guarded by the current PIN.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import {
  getParentalSnapshot,
  InvalidPinError,
  isCategoryLocked,
  isValidPin,
  loadParentalControl,
  lockParental,
  ParentalLockedError,
  PIN_HASH_ITERATIONS,
  removeParentalPin,
  resetParentalForTests,
  setParentalPin,
  setRestrictedCategories,
  unlockParental,
  WrongPinError,
} from './parental';

const FAST = { iterations: 1_000 };
const KIDS = 's1:movie:~c:kids';
const NEWS = 's1:live:~c:news';

beforeEach(() => resetParentalForTests(FAST));
afterEach(async () => {
  resetParentalForTests();
  await wipeAll();
});

/** As after closing and reopening the app: memory forgotten, storage kept. */
const reopen = () => resetParentalForTests(FAST);

describe('SEC-03 — PIN', () => {
  it('accepts 4 to 8 digits only', () => {
    for (const ok of ['1234', '12345678', '0000']) expect(isValidPin(ok)).toBe(true);
    for (const bad of ['123', '123456789', '12a4', ' 1234', '١٢٣٤', '']) {
      expect(isValidPin(bad)).toBe(false);
    }
  });

  it('is stored as a salted PBKDF2 hash, never the PIN', async () => {
    await expect(setParentalPin('12')).rejects.toBeInstanceOf(InvalidPinError);
    await setParentalPin('4321');
    const stored = (await settingsRepo.get('parentalControl')) as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain('4321');
    expect(stored).toMatchObject({ version: 1, iterations: FAST.iterations, restricted: [] });
    expect(typeof stored.salt).toBe('string');
    expect(atob(stored.hash as string)).toHaveLength(32);
    // Same PIN, new salt → another hash.
    await setParentalPin('4321', '4321');
    const again = (await settingsRepo.get('parentalControl')) as Record<string, unknown>;
    expect(again.salt).not.toBe(stored.salt);
    expect(again.hash).not.toBe(stored.hash);
    expect(PIN_HASH_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });

  it('change and remove need the current PIN', async () => {
    await setParentalPin('1111');
    await expect(setParentalPin('2222')).rejects.toBeInstanceOf(WrongPinError);
    await expect(setParentalPin('2222', '9999')).rejects.toBeInstanceOf(WrongPinError);
    await setParentalPin('2222', '1111');
    await expect(removeParentalPin('1111')).rejects.toBeInstanceOf(WrongPinError);
    expect(getParentalSnapshot().pinSet).toBe(true);
    await removeParentalPin('2222');
    expect(getParentalSnapshot().pinSet).toBe(false);
    expect(await settingsRepo.get('parentalControl')).toBeUndefined();
  });

  it('an invalid stored value counts as no PIN', async () => {
    await settingsRepo.set('parentalControl', { version: 1, salt: 3, hash: 'x' });
    expect((await loadParentalControl()).pinSet).toBe(false);
  });
});

describe('SEC-03 — restricted categories and the session unlock', () => {
  it('restricted categories are locked until the PIN is entered, for the session', async () => {
    await setParentalPin('1234');
    await setRestrictedCategories('s1:movie:', [KIDS, NEWS]); // NEWS is outside the prefix
    expect([...getParentalSnapshot().restricted]).toEqual([KIDS]);
    await setRestrictedCategories('s1:live:', [NEWS]);
    expect(getParentalSnapshot().unlocked).toBe(true);
    expect(isCategoryLocked(KIDS)).toBe(false);

    lockParental();
    expect(isCategoryLocked(KIDS)).toBe(true);
    expect(isCategoryLocked(NEWS)).toBe(true);
    expect(isCategoryLocked('s1:movie:~c:other')).toBe(false);
    expect(isCategoryLocked(undefined)).toBe(false);
    await expect(setRestrictedCategories('s1:movie:', [])).rejects.toBeInstanceOf(
      ParentalLockedError,
    );

    expect(await unlockParental('0000')).toBe(false);
    expect(isCategoryLocked(KIDS)).toBe(true);
    expect(await unlockParental('1234')).toBe(true);
    expect(isCategoryLocked(KIDS)).toBe(false);

    // Closing the app locks again; the restrictions persist.
    reopen();
    const snapshot = await loadParentalControl();
    expect(snapshot).toMatchObject({ known: true, pinSet: true, unlocked: false });
    expect(isCategoryLocked(KIDS, snapshot)).toBe(true);
  });

  it('removing the PIN forgets the restrictions', async () => {
    await setParentalPin('1234');
    await setRestrictedCategories('s1:movie:', [KIDS]);
    await removeParentalPin('1234');
    await setParentalPin('5678');
    expect(getParentalSnapshot().restricted.size).toBe(0);
  });

  it('without a PIN nothing is locked', async () => {
    const snapshot = await loadParentalControl();
    expect(snapshot.pinSet).toBe(false);
    expect(snapshot.locked.size).toBe(0);
    await expect(setRestrictedCategories('s1:movie:', [KIDS])).rejects.toBeInstanceOf(
      ParentalLockedError,
    );
  });
});
