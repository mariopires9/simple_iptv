import { describe, expect, it } from 'vitest';
import { findViolations, isAllowed } from './check-licenses.mjs';

describe('license allowlist (FND-02 AC2)', () => {
  it.each(['MIT', 'Apache-2.0', '(MIT OR GPL-3.0)', 'ISC', 'BSD-3-Clause'])('accepts %s', (l) => {
    expect(isAllowed(l)).toBe(true);
  });
  it.each(['GPL-3.0', 'AGPL-3.0', '(MIT AND GPL-3.0)', '', undefined, 'UNLICENSED'])(
    'rejects %s',
    (l) => {
      expect(isAllowed(l)).toBe(false);
    },
  );
  it('reports the name of the violating package', () => {
    const bad = findViolations([
      { name: 'ok@1.0.0', license: 'MIT' },
      { name: 'bad@2.0.0', license: 'GPL-3.0' },
    ]);
    expect(bad.map((p) => p.name)).toEqual(['bad@2.0.0']);
  });
});
