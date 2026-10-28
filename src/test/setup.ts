import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// App-level tests boot the whole app (DB check, onboarding guard, lazy route chunks); under
// coverage on a loaded CI machine that can exceed Testing Library's default 1 s wait. This is only
// an upper bound: `findBy*`/`waitFor` still resolve as soon as the condition holds.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
