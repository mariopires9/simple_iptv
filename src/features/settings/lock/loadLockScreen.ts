// SEC-02: lazy entry of the unlock screen (its own chunk, with the `lock` and `settings` strings:
// "Delete all data" lives in the settings namespace). Statically reachable from the shell, so it
// imports nothing heavy itself.
import type { ComponentType } from 'react';
import { ensureMessages } from '@/i18n';
import type { LockScreenProps } from './LockScreen';

export async function loadLockScreen(): Promise<{ default: ComponentType<LockScreenProps> }> {
  const [module] = await Promise.all([import('./LockScreen'), ensureMessages('lock', 'settings')]);
  return { default: module.LockScreen };
}
