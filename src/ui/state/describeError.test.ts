import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultKeyLostError, type VaultKeyLostReason } from '@/core/crypto';
import { DatabaseUnavailableError, type DatabaseUnavailableReason } from '@/core/db';
import { clearSecrets, registerSecret } from '@/core/log';
import { NetError, type NetErrorHint, type NetErrorKind } from '@/core/net';
import { WorkerTaskError } from '@/core/worker';
import { messages } from '@/i18n/catalogs';
import { describeError, errorDetails, MAX_DETAILS_LENGTH } from './describeError';

const en = messages('en');
const pt = messages('pt-PT');

afterEach(() => clearSecrets());

const KINDS: NetErrorKind[] = ['offline', 'timeout', 'aborted', 'blocked', 'http', 'auth', 'parse'];
const HINTS: (NetErrorHint | undefined)[] = [undefined, 'cors', 'mixed-content'];

/** Expected [code, action, variant] for a NetError kind × hint. */
function expectedNet(kind: NetErrorKind, hint: NetErrorHint | undefined) {
  if (kind === 'blocked' && hint === 'cors') return ['net.blocked.cors', 'edit-source', 'error'];
  if (kind === 'blocked' && hint === 'mixed-content')
    return ['net.blocked.mixed-content', 'edit-source', 'error'];
  if (kind === 'offline') return ['net.offline', 'retry', 'offline'];
  if (kind === 'auth') return ['net.auth', 'reenter-credentials', 'error'];
  if (kind === 'aborted') return ['net.aborted', 'none', 'empty'];
  return [`net.${kind}`, 'retry', 'error'];
}

describe('describeError — NetError (every kind × hint)', () => {
  const cases = KINDS.flatMap((kind) => HINTS.map((hint) => [kind, hint] as const));

  it.each(cases)('%s / hint %s', (kind, hint) => {
    const error = new NetError({
      kind,
      ...(hint ? { hint } : {}),
      url: 'http://example.test/player_api.php?username=u&password=p',
    });
    const [code, action, variant] = expectedNet(kind, hint);
    const d = describeError(error, en);
    expect(d.code).toBe(code);
    expect(d.action).toBe(action);
    expect(d.variant).toBe(variant);
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.message.length).toBeGreaterThan(0);
    expect(d.cancelled).toBe(kind === 'aborted');
    expect(d.actionLabel).toBe(
      action === 'none'
        ? undefined
        : en.state.actions[action as 'retry' | 'edit-source' | 'reenter-credentials'],
    );
    expect(d.details).toContain('NetError');
    expect(d.details).not.toMatch(/example\.test|username=u|password=p/);
  });

  it('uses the localized texts of the given catalog', () => {
    const error = new NetError({ kind: 'blocked', hint: 'cors' });
    expect(describeError(error, en).title).toBe(en.state.errors.net.blockedCors.title);
    expect(describeError(error, pt).title).toBe(pt.state.errors.net.blockedCors.title);
    expect(describeError(error, pt).actionLabel).toBe(pt.state.actions['edit-source']);
  });

  it('http: includes the status when known', () => {
    expect(describeError(new NetError({ kind: 'http', status: 503 }), en).message).toBe(
      en.state.errors.net.httpStatus('503'),
    );
    expect(describeError(new NetError({ kind: 'http' }), en).message).toBe(
      en.state.errors.net.http.message,
    );
  });

  it('a hint on a kind other than blocked does not change the mapping', () => {
    const plain = describeError(new NetError({ kind: 'timeout' }), en);
    const hinted = describeError(new NetError({ kind: 'timeout', hint: 'cors' }), en);
    expect(hinted.code).toBe(plain.code);
    expect(hinted.message).toBe(plain.message);
  });

  it('auth suggests re-entering the password', () => {
    const d = describeError(new NetError({ kind: 'auth', status: 401 }), en);
    expect(d.actionLabel).toBe('Re-enter password');
    expect(describeError(new NetError({ kind: 'auth' }), pt).actionLabel).toBe(
      pt.state.actions['reenter-credentials'],
    );
  });
});

// Review finding 3: a cancellation is not a failure.
describe('describeError — cancellations are neutral', () => {
  it.each([
    ['NetError aborted', new NetError({ kind: 'aborted' }), 'net.aborted'],
    ['WorkerTaskError cancelled', new WorkerTaskError('cancelled'), 'worker.cancelled'],
  ])('%s', (_label, error, code) => {
    const d = describeError(error, en);
    expect(d).toMatchObject({
      code,
      cancelled: true,
      variant: 'empty',
      action: 'none',
      actionLabel: undefined,
      title: en.state.errors.cancelled.title,
      message: en.state.errors.cancelled.message,
    });
  });
});

describe('describeError — WorkerTaskError failed', () => {
  it('failed → retry', () => {
    const d = describeError(new WorkerTaskError('failed'), en);
    expect(d).toMatchObject({
      code: 'worker.failed',
      action: 'retry',
      actionLabel: 'Try again',
      variant: 'error',
      cancelled: false,
      title: en.state.errors.worker.failed.title,
    });
    expect(d.details).toContain('WorkerTaskError');
  });
});

describe('describeError — DatabaseUnavailableError', () => {
  it.each(['unsupported', 'open-failed', 'timeout'] satisfies DatabaseUnavailableReason[])(
    '%s',
    (reason) => {
      const d = describeError(new DatabaseUnavailableError(reason), en);
      expect(d).toMatchObject({
        code: `db.${reason}`,
        action: 'reload',
        actionLabel: 'Reload',
        title: en.state.errors.db.title,
        message: en.db.errors[reason],
      });
    },
  );
});

describe('describeError — VaultKeyLostError', () => {
  it.each(['missing-key', 'decrypt-failed'] satisfies VaultKeyLostReason[])('%s', (reason) => {
    const d = describeError(new VaultKeyLostError('source:1:password', reason), en);
    expect(d).toMatchObject({
      code: `vault.${reason}`,
      action: 'reenter-credentials',
      actionLabel: en.state.actions['reenter-credentials'],
      title: en.state.errors.vault[reason].title,
      message: en.state.errors.vault[reason].message,
    });
  });
});

describe('describeError — unknown errors', () => {
  it.each([
    ['a plain Error', new Error('boom')],
    ['a TypeError', new TypeError('x is not a function')],
    ['a string', 'something bad'],
    ['undefined', undefined],
    ['null', null],
    ['an object', { kind: 'timeout' }],
    // Look-alikes: the right name with an unknown discriminant is not trusted.
    [
      'a NetError look-alike with an unknown kind',
      Object.assign(new Error('x'), { name: 'NetError', kind: 'weird' }),
    ],
    [
      'a db look-alike without reason',
      Object.assign(new Error('x'), { name: 'DatabaseUnavailableError' }),
    ],
  ])('%s → generic', (_label, error) => {
    const d = describeError(error, en);
    expect(d).toMatchObject({
      code: 'unknown',
      action: 'retry',
      variant: 'error',
      title: en.state.errors.unknown.title,
      message: en.state.errors.unknown.message,
    });
  });

  it('recognises a typed error structurally (no instanceof needed)', () => {
    const lookAlike = Object.assign(new Error('Request timed out'), {
      name: 'NetError',
      kind: 'timeout',
    });
    expect(describeError(lookAlike, en).code).toBe('net.timeout');
  });
});

describe('describeError — details', () => {
  it('redacts registered secrets and credential patterns', () => {
    registerSecret('hunter2-secret');
    const error = new Error('Login failed for hunter2-secret at http://h/get.php?password=abc');
    const { details } = describeError(error, en);
    expect(details).not.toContain('hunter2-secret');
    expect(details).not.toContain('abc');
    expect(details).toContain('***');
  });

  it('never includes stack traces, also from causes', () => {
    const cause = new Error('inner cause');
    const error = new Error('outer', { cause });
    error.stack = 'Error: outer\n    at secretFunction (http://h/app.js:1:2)';
    cause.stack = 'Error: inner\n    at other (file.ts:3:4)';
    const { details } = describeError(error, en);
    expect(details).toBe('Error: outer\nCaused by: Error: inner cause');
    expect(details).not.toMatch(/\bat\s|secretFunction|file\.ts/);
  });

  // Review finding 6: messages are kept whole (only `stack`, which is never read, holds frames).
  it('keeps every line of the message, even ones that start with "at"', () => {
    const error = new Error('Invalid M3U\nat least one #EXTINF entry is required');
    expect(describeError(error, en).details).toBe(
      'Error: Invalid M3U\nat least one #EXTINF entry is required',
    );
  });

  // Review finding 5.
  it('stops at a null or undefined cause', () => {
    expect(errorDetails(new Error('outer', { cause: null }))).toBe('Error: outer');
    expect(errorDetails(new Error('outer', { cause: undefined }))).toBe('Error: outer');
  });

  it('uses the string message of a thrown plain object (redacted), never other fields', () => {
    registerSecret('obj-secret');
    expect(errorDetails({ message: 'failed for obj-secret', password: 'pw-123' })).toBe(
      'failed for ***',
    );
    expect(errorDetails(new Error('outer', { cause: { message: 'inner obj' } }))).toBe(
      'Error: outer\nCaused by: inner obj',
    );
    expect(errorDetails({ message: 42 })).toBe('Thrown object');
    expect(errorDetails(null)).toBe('Thrown null');
  });

  it('follows the cause chain up to 3 levels and redacts every level', () => {
    registerSecret('topsecret');
    const deep = new Error('level 4');
    const c3 = new Error('level 3', { cause: deep });
    const c2 = new Error('level 2 topsecret', { cause: c3 });
    const c1 = new Error('level 1', { cause: c2 });
    const error = new Error('level 0', { cause: c1 });
    const { details } = describeError(error, en);
    expect(details.split('\n')).toEqual([
      'Error: level 0',
      'Caused by: Error: level 1',
      'Caused by: Error: level 2 ***',
      'Caused by: Error: level 3',
    ]);
  });

  it('describes non-Error values without serialising them', () => {
    expect(errorDetails({ password: 'x' })).toBe('Thrown object');
    expect(errorDetails(42)).toBe('Thrown number');
    expect(errorDetails('plain text')).toBe('plain text');
  });

  it('is capped in length', () => {
    const details = errorDetails(new Error('x'.repeat(MAX_DETAILS_LENGTH * 2)));
    expect(details.length).toBe(MAX_DETAILS_LENGTH);
    expect(details.endsWith('…')).toBe(true);
  });
});
