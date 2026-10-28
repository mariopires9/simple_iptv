import { describe, expect, it } from 'vitest';
import { findViolations, isAllowed } from './check-licenses.mjs';

describe('allowlist de licenças (FND-02 CA2)', () => {
  it.each(['MIT', 'Apache-2.0', '(MIT OR GPL-3.0)', 'ISC', 'BSD-3-Clause'])('aceita %s', (l) => {
    expect(isAllowed(l)).toBe(true);
  });
  it.each(['GPL-3.0', 'AGPL-3.0', '(MIT AND GPL-3.0)', '', undefined, 'UNLICENSED'])(
    'rejeita %s',
    (l) => {
      expect(isAllowed(l)).toBe(false);
    },
  );
  it('indica o nome do pacote em violação', () => {
    const bad = findViolations([
      { name: 'ok@1.0.0', license: 'MIT' },
      { name: 'mau@2.0.0', license: 'GPL-3.0' },
    ]);
    expect(bad.map((p) => p.name)).toEqual(['mau@2.0.0']);
  });
});
