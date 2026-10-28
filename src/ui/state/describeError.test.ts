import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultKeyLostError, type VaultKeyLostReason } from '@/core/crypto';
import { DatabaseUnavailableError, type DatabaseUnavailableReason } from '@/core/db';
import { clearSecrets, registerSecret } from '@/core/log';
import { NetError, type NetErrorHint, type NetErrorKind } from '@/core/net';
import { WorkerTaskError } from '@/core/worker';
import { messages } from '@/i18n';
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
  if (kind === 'auth') return ['net.auth', 'edit-source', 'error'];
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
    expect(d.actionLabel).toBe(en.state.actions[action as 'retry' | 'edit-source']);
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
});

describe('describeError — WorkerTaskError', () => {
  it.each([
    ['cancelled', 'worker.cancelled', 'none', undefined],
    ['failed', 'worker.failed', 'retry', 'Try again'],
  ] as const)('%s', (kind, code, action, label) => {
    const d = describeError(new WorkerTaskError(kind), en);
    expect(d).toMatchObject({ code, action, actionLabel: label, variant: 'error' });
    expect(d.title).toBe(en.state.errors.worker[kind].title);
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

  it('drops stack-frame-looking lines embedded in a message', () => {
    const error = new Error('first line\n    at fn (x.js:1:1)\nfn@http://h/x.js:1:1\nlast line');
    expect(describeError(error, en).details).toBe('Error: first line\nlast line');
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
    expect(errorDetails('plain text')).toBe('plain text');
  });

  it('is capped in length', () => {
    const details = errorDetails(new Error('x'.repeat(MAX_DETAILS_LENGTH * 2)));
    expect(details.length).toBe(MAX_DETAILS_LENGTH);
    expect(details.endsWith('…')).toBe(true);
  });
});
