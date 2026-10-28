import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, registerSecret } from '@/core/log';
import { NetError, isNetError, shortenUrl } from './errors';

// Fictitious data: never use real credentials in tests (CLAUDE.md).
const HOST = 'iptv.example.test';
const USER = 'jdoe';
const PASS = 'abc123';
const URLS = [
  `http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}&action=get_vod_streams`,
  `http://${HOST}/get.php?username=${USER}&password=${PASS}&type=m3u_plus`,
  `https://${HOST}/live/${USER}/${PASS}/42.ts`,
  `http://${USER}:${PASS}@${HOST}/movie/${USER}/${PASS}/7.mp4?token=t0k3n`,
];

afterEach(() => {
  clearSecrets();
});

function exposed(e: NetError): string {
  return [e.message, e.target ?? '', String(e), e.stack ?? '', JSON.stringify(e)].join('\n');
}

describe('NetError', () => {
  it.each(URLS)('never exposes host, username, password or query: %s', (url) => {
    const e = new NetError({ kind: 'http', status: 500, url });
    const text = exposed(e);
    expect(text).not.toContain(HOST);
    expect(text).not.toContain(USER);
    expect(text).not.toContain(PASS);
    expect(text).not.toContain('?');
    expect(text).not.toContain('t0k3n');
    expect(text).not.toContain(url);
  });

  it('stores kind, status and hint and shows a shortened URL', () => {
    const e = new NetError({
      kind: 'blocked',
      hint: 'mixed-content',
      url: `http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}`,
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NetError');
    expect(e.kind).toBe('blocked');
    expect(e.hint).toBe('mixed-content');
    expect(e.status).toBeUndefined();
    expect(e.target).toBe('http://***/player_api.php');
    expect(e.message).toBe(
      'Request blocked by the browser (blocked, mixed-content): http://***/player_api.php',
    );
  });

  it('redacts credentials in the path of the shortened URL', () => {
    const e = new NetError({
      kind: 'auth',
      status: 401,
      url: `https://${HOST}/live/${USER}/${PASS}/1.ts`,
    });
    expect(e.target).toBe('https://***/live/***/***/***.ts');
    expect(e.message).toContain('(auth, HTTP 401)');
  });

  // Regression (review): only the known first segment and the final extension stay visible.
  it.each([
    [`http://${HOST}/${USER}/${PASS}/1.ts`, 'http://***/***/***/***.ts'],
    [`http://${HOST}/player_api.php?username=${USER}`, 'http://***/player_api.php'],
    [`http://${HOST}/get.php?username=${USER}`, 'http://***/get.php'],
    [`http://${HOST}/xmltv.php?password=${PASS}`, 'http://***/xmltv.php'],
    [
      `http://${HOST}/timeshift/${USER}/${PASS}/60/x/5.ts`,
      'http://***/timeshift/***/***/***/***/***.ts',
    ],
    [`http://${HOST}/panel/${USER}/account`, 'http://***/***/***/***'],
    [`http://${HOST}/a/${USER}.php`, 'http://***/***/***.php'],
    [`http://${HOST}/`, 'http://***/'],
    [`http://${HOST}/x/`, 'http://***/***/'],
  ])('shortenUrl(%s) → %s', (url, expected) => {
    expect(shortenUrl(url)).toBe(expected);
  });

  it('does not keep unknown segments even without a registered secret', () => {
    const e = new NetError({ kind: 'http', url: `http://${HOST}/${USER}/${PASS}/1.ts` });
    expect(exposed(e)).not.toMatch(new RegExp(`${USER}|${PASS}`));
  });

  it('has no target without a URL or with an invalid URL', () => {
    expect(new NetError({ kind: 'offline' }).target).toBeUndefined();
    expect(new NetError({ kind: 'parse', url: 'not a url' }).target).toBeUndefined();
    expect(new NetError({ kind: 'offline' }).message).toBe('No network connection (offline)');
  });

  it('stores the cause only in redacted form', () => {
    registerSecret(PASS);
    const cause = new TypeError(`Failed to fetch http://${HOST}/get.php?password=${PASS}`);
    const e = new NetError({ kind: 'blocked', hint: 'cors', cause });
    expect(e.cause).toBeInstanceOf(Error);
    expect((e.cause as Error).name).toBe('TypeError');
    expect((e.cause as Error).message).not.toContain(PASS);
    expect((e.cause as Error).stack ?? '').not.toContain(PASS);
    expect(new NetError({ kind: 'parse', cause: `password=${PASS}` }).cause).toBe('password=***');
  });

  // Regression (review): the cause chain is preserved (redacted) up to 3 levels.
  it('keeps the redacted cause chain, limited to 3 levels', () => {
    const l4 = new Error(`level 4 password=${PASS}`);
    const l3 = new Error(`level 3 password=${PASS}`, { cause: l4 });
    const l2 = new RangeError(`level 2 /live/${USER}/${PASS}/1.ts`, { cause: l3 });
    const l1 = new TypeError(`level 1 token=${PASS}`, { cause: l2 });
    const e = new NetError({ kind: 'blocked', cause: l1 });

    const c1 = e.cause as Error;
    const c2 = c1.cause as Error;
    const c3 = c2.cause as Error;
    expect([c1.name, c2.name, c3.name]).toEqual(['TypeError', 'RangeError', 'Error']);
    expect(c1.message).toBe('level 1 token=***');
    expect(c2.message).toBe('level 2 /live/***/***/1.ts');
    expect(c3.message).toBe('level 3 password=***');
    expect(c3.cause).toBeUndefined();
  });

  it('does not loop on circular causes', () => {
    const a = new Error('a');
    (a as { cause?: unknown }).cause = a;
    const e = new NetError({ kind: 'parse', cause: a });
    expect((e.cause as Error).message).toBe('a');
  });

  // Regression (review): an object cause becomes redacted JSON, not "[object Object]".
  it('serializes object causes as redacted JSON', () => {
    const e = new NetError({
      kind: 'http',
      cause: { status: 500, url: `http://${HOST}/get.php?username=${USER}&password=${PASS}` },
    });
    expect(e.cause).toBe(`{"status":500,"url":"http://${HOST}/get.php?username=***&password=***"}`);
  });
});

describe('isNetError', () => {
  it('distinguishes NetError from other errors', () => {
    expect(isNetError(new NetError({ kind: 'timeout' }))).toBe(true);
    expect(isNetError(new Error('x'))).toBe(false);
    expect(isNetError({ name: 'NetError', kind: 'timeout' })).toBe(false);
    expect(isNetError(undefined)).toBe(false);
  });
});
