import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setVaultLockOff } from '@/core/crypto/lockState';
import { loadAllMessages } from '@/i18n';

// App-level tests boot the whole app (DB check, onboarding guard, lazy route chunks); under
// coverage on a loaded CI machine that can exceed Testing Library's default 1 s wait. This is only
// an upper bound: `findBy*`/`waitFor` still resolve as soon as the condition holds.
configure({ asyncUtilTimeout: 5000 });

// Feature strings load with their feature (TEC-01); tests render feature components directly and
// read `t.<feature>` at collection time (`it.each` tables, module-level constants), so every
// namespace is on `t` before the test file is even imported.
await loadAllMessages();

// Hook order trap (TEC-03): Vitest runs `afterEach` hooks in reverse registration order, so this
// one (registered first) runs AFTER every test file's own `afterEach`. A file that resets shared
// state there (`wipeAll`, `forgetActiveSource`, cache invalidation) must call `cleanup()` first,
// or a screen still mounted can re-read and re-cache that state for the next test. (The global
// alternative, `test.sequence.hooks: 'list'`, lives in the serialized vite.config.ts.)
afterEach(() => {
  cleanup();
});

// SEC-02: the vault writes with the device key only once the master password is known to be off
// (the app decides at start-up, `initVaultLock`). Tests that do not exercise the lock start there;
// lock tests set the state themselves. Also at load time, for `beforeAll` hooks.
setVaultLockOff();
beforeEach(() => {
  setVaultLockOff();
});
