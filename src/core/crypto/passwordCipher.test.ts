// EXP-01 — password-based encryption via WebCrypto: roundtrip, wrong password / altered data /
// other additional data rejected, the iteration floor enforced both ways. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  decryptWithPassword,
  encryptWithPassword,
  MIN_PBKDF2_ITERATIONS,
  PasswordDecryptError,
} from './passwordCipher';

const SECRET = 'synthetic secret ✓';

describe('passwordCipher (EXP-01)', () => {
  it('roundtrips; a fresh salt and IV per encryption', async () => {
    const a = await encryptWithPassword(SECRET, 'pw-123456', { aad: 'ctx' });
    const b = await encryptWithPassword(SECRET, 'pw-123456', { aad: 'ctx' });
    expect(a.iterations).toBe(MIN_PBKDF2_ITERATIONS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(atob(a.ciphertext)).not.toContain('synthetic');
    expect(await decryptWithPassword(a, 'pw-123456', { aad: 'ctx' })).toBe(SECRET);
  });

  it('rejects a wrong password, altered data and other additional data', async () => {
    const envelope = await encryptWithPassword(SECRET, 'pw-123456', { aad: 'ctx' });
    const rejects = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(PasswordDecryptError);
    await rejects(decryptWithPassword(envelope, 'wrong', { aad: 'ctx' }));
    await rejects(decryptWithPassword(envelope, 'pw-123456', { aad: 'other' }));
    const iv = envelope.iv.startsWith('A')
      ? `B${envelope.iv.slice(1)}`
      : `A${envelope.iv.slice(1)}`;
    await rejects(decryptWithPassword({ ...envelope, iv }, 'pw-123456', { aad: 'ctx' }));
    await rejects(decryptWithPassword({ ...envelope, salt: '***' }, 'pw-123456', { aad: 'ctx' }));
  });

  it('never uses fewer than 600 000 iterations', async () => {
    await expect(encryptWithPassword(SECRET, 'pw', { iterations: 1_000 })).rejects.toThrow(
      RangeError,
    );
    const envelope = await encryptWithPassword(SECRET, 'pw');
    await expect(
      decryptWithPassword({ ...envelope, iterations: 1_000 }, 'pw'),
    ).rejects.toBeInstanceOf(PasswordDecryptError);
    await expect(encryptWithPassword(SECRET, '')).rejects.toThrow(TypeError);
  });
});
