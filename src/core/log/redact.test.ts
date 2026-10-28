import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, redact, registerSecret, unregisterSecret } from './redact';

// Fictitious data: never use real credentials in tests (CLAUDE.md).
afterEach(() => {
  clearSecrets();
});

describe('redact — query parameters', () => {
  it('redacts the AC1 examples', () => {
    expect(redact('password=abc')).toBe('password=***');
    expect(redact('username=joao')).toBe('username=***');
  });

  it('redacts an Xtream API URL', () => {
    expect(
      redact(
        'http://example.test:8080/player_api.php?username=joao&password=abc&action=get_live_streams',
      ),
    ).toBe(
      'http://example.test:8080/player_api.php?username=***&password=***&action=get_live_streams',
    );
  });

  it('redacts an M3U get.php URL', () => {
    expect(
      redact('http://example.test/get.php?username=joao&password=abc&type=m3u_plus&output=ts'),
    ).toBe('http://example.test/get.php?username=***&password=***&type=m3u_plus&output=ts');
  });

  it('redacts pass, token, auth and key, including prefixed names like api_key', () => {
    expect(redact('?pass=p1&token=t1&auth=a1&key=k1&api_key=k2&access-token=t2')).toBe(
      '?pass=***&token=***&auth=***&key=***&api_key=***&access-token=***',
    );
  });

  it('ignores case in the parameter name', () => {
    expect(redact('?UserName=joao&PASSWORD=abc&Token=xyz')).toBe(
      '?UserName=***&PASSWORD=***&Token=***',
    );
  });

  it('redacts URL-encoded parameters (URL inside another parameter)', () => {
    const inner = encodeURIComponent(
      'http://example.test/get.php?username=joao&password=abc&type=m3u',
    );
    const out = redact(`https://proxy.test/?url=${inner}`);
    expect(out).not.toContain('joao');
    expect(out).not.toContain('abc');
    expect(out).toContain('username%3D***%26password%3D***%26type%3Dm3u');
  });

  it('redacts the whole value even with encoded characters', () => {
    expect(redact('password=a%26b%20c&x=1')).toBe('password=***&x=1');
  });

  it('redacts JSON fields with sensitive names', () => {
    expect(redact('{"username":"joao","password":"a\\"bc","name":"Channel"}')).toBe(
      '{"username":"***","password":"***","name":"Channel"}',
    );
  });

  it('does not confuse similar names (passport, bypass, monkey)', () => {
    const text = 'passport=1&bypass=2&monkey=3&keyboard=4';
    expect(redact(text)).toBe(text);
  });
});

describe('redact — Xtream stream paths', () => {
  it.each(['live', 'movie', 'series', 'timeshift'])('redacts /%s/<user>/<pass>/', (type) => {
    expect(redact(`http://example.test:8080/${type}/joao/abc/1.ts`)).toBe(
      `http://example.test:8080/${type}/***/***/1.ts`,
    );
  });

  it('redacts the AC1 example', () => {
    expect(redact('/live/joao/abc/1.ts')).toBe('/live/***/***/1.ts');
  });

  it('redacts timeshift with extra segments', () => {
    expect(redact('/timeshift/joao/abc/60/2026-01-01:10-00/42.ts')).toBe(
      '/timeshift/***/***/60/2026-01-01:10-00/42.ts',
    );
  });

  it('redacts %2F-encoded paths', () => {
    expect(redact('url=http%3A%2F%2Fh.test%2Flive%2Fjoao%2Fabc%2F1.ts')).toBe(
      'url=http%3A%2F%2Fh.test%2Flive%2F***%2F***%2F1.ts',
    );
  });
});

describe('redact — userinfo', () => {
  it('redacts scheme://user:pass@host', () => {
    expect(redact('http://joao:abc@example.test:8080/get.php')).toBe(
      'http://***@example.test:8080/get.php',
    );
    expect(redact('error at rtmp://joao@example.test/app')).toBe(
      'error at rtmp://***@example.test/app',
    );
  });
});

describe('redact — registered secrets', () => {
  it('redacts a registered secret at any position', () => {
    registerSecret('s3gr3d0');
    expect(redact('failed with s3gr3d0 in the middle')).toBe('failed with *** in the middle');
    expect(redact('xs3gr3d0x')).toBe('x***x');
  });

  it('redacts the URL-encoded form', () => {
    registerSecret('p@ss w/rd&1');
    const out = redact(`?x=${encodeURIComponent('p@ss w/rd&1')}`);
    expect(out).toBe('?x=***');
  });

  it('redacts the base64 form', () => {
    registerSecret('s3gr3d0');
    expect(redact(`Authorization: Basic ${btoa('s3gr3d0')}`)).toBe('Authorization: Basic ***');
    expect(redact(`x=${btoa('s3gr3d0').replace(/=+$/, '')}`)).toBe('x=***');
  });

  it('redacts base64 of secrets with non-ASCII characters', () => {
    registerSecret('secret-çã');
    const bytes = new TextEncoder().encode('secret-çã');
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(redact(b64)).toBe('***');
  });

  it('ignores secrets shorter than 3 characters', () => {
    registerSecret('a');
    registerSecret('ab');
    expect(redact('abcabc a ab')).toBe('abcabc a ab');
  });

  it('unregisterSecret and clearSecrets stop redacting', () => {
    registerSecret('alfa123');
    registerSecret('beta456');
    unregisterSecret('alfa123');
    expect(redact('alfa123 beta456')).toBe('alfa123 ***');
    clearSecrets();
    expect(redact('alfa123 beta456')).toBe('alfa123 beta456');
  });

  it('a secret contained in another one leaves no leftovers', () => {
    registerSecret('abc');
    registerSecret('abcdef');
    expect(redact('abcdef')).toBe('***');
  });
});

describe('redact — text without secrets', () => {
  it.each([
    'Sync complete: 1200 channels',
    'http://example.test/epg.xml',
    'https://example.test/player_api.php?action=get_live_categories',
    '/live/1.ts',
    'a=b&c=d',
    '',
  ])('leaves "%s" unchanged', (text) => {
    expect(redact(text)).toBe(text);
  });

  it('is idempotent', () => {
    const once = redact('http://joao:abc@h.test/live/joao/abc/1.ts?password=abc');
    expect(redact(once)).toBe(once);
  });
});

describe('redact — performance', () => {
  // Regression: patterns that started at every `-`, `_` or `.` had quadratic cost (~1 s for 80 KB).
  it.each([
    'a-',
    'a_',
    'b.',
    '"a-',
    '%2Flive%2F',
    'http://a/',
    '"key":[',
    'aKey=',
    '%3A%2F%2Fa%2F',
  ])('long text with "%s" repeated is linear', (unit) => {
    const text = unit.repeat(40_000) + '=x';
    const start = performance.now();
    redact(text);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('redact — review regressions', () => {
  it('redacts camelCase and compound names (accessToken, apiKey, refreshToken, Authorization)', () => {
    expect(redact('?accessToken=t1&apiKey=k1&refreshToken=r1&Authorization=a1&userName=joao')).toBe(
      '?accessToken=***&apiKey=***&refreshToken=***&Authorization=***&userName=***',
    );
    expect(redact('url=%3Fx%3D1%26apiKey%3Dk1%26y%3D2')).toBe(
      'url=%3Fx%3D1%26apiKey%3D***%26y%3D2',
    );
  });

  it('still does not confuse passport, bypass, monkey, keyboard, turnkey or APIKEY', () => {
    const text = '?passport=1&bypass=2&monkey=3&keyboard=4&turnkey=5&Passport=6&APIKEY=7';
    expect(redact(text)).toBe(text);
  });

  it('redacts sensitive parameters inside the value of another parameter', () => {
    expect(redact('url=http://h.test/?a=1&password=abc')).toBe(
      'url=http://h.test/?a=1&password=***',
    );
  });

  it('redacts the Authorization header in JSON and in free text', () => {
    expect(redact('{"Authorization":"Basic dXNlcjpwYXNz"}')).toBe('{"Authorization":"***"}');
    expect(redact('headers: Authorization: Basic dXNlcjpwYXNz; ok')).toBe(
      'headers: Authorization: Basic ***; ok',
    );
    expect(redact('authorization: Bearer eyJhbGciOi.x.y')).toBe('authorization: Bearer ***');
    expect(redact('with Bearer abc.def-ghi end')).toBe('with Bearer *** end');
  });

  it('redacts the application/x-www-form-urlencoded form of a registered secret', () => {
    const secret = "p ss!(x)'~*";
    registerSecret(secret);
    const form = new URLSearchParams({ q: secret }).toString();
    expect(form).not.toBe(`q=${encodeURIComponent(secret)}`);
    expect(redact(form)).toBe('q=***');
    registerSecret('p ss!(x)');
    expect(redact(new URLSearchParams({ q: 'p ss!(x)' }).toString())).toBe('q=***');
  });

  it.each([
    ['http://h.test:8080/joao/abc/12345.ts', 'http://h.test:8080/***/***/12345.ts'],
    ['http://h.test/joao/abc/12345', 'http://h.test/***/***/12345'],
    [
      '#EXTINF:-1,Channel\nhttp://h.test/joao/abc/7.m3u8\n',
      '#EXTINF:-1,Channel\nhttp://h.test/***/***/7.m3u8\n',
    ],
    [
      'u=http%3A%2F%2Fh.test%2Fjoao%2Fabc%2F99.ts%26x',
      'u=http%3A%2F%2Fh.test%2F***%2F***%2F99.ts%26x',
    ],
  ])('redacts an unprefixed Xtream path: %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it('does not redact paths with a different shape', () => {
    for (const text of [
      'http://h.test/a/b/c/1.ts',
      'http://h.test/a/1.ts',
      'http://h.test/a/b/x.ts',
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  it('redacts non-string JSON values, whole objects and arrays', () => {
    expect(
      redact(
        '{"pass":1234,"token":true,"auth":null,"apiKey":{"a":"}","b":[1,2]},"key":[1,[2]],"n":5}',
      ),
    ).toBe('{"pass":"***","token":"***","auth":"***","apiKey":"***","key":"***","n":5}');
    expect(redact('{ "password" : -1.5e3 }')).toBe('{ "password" : "***" }');
  });
});
