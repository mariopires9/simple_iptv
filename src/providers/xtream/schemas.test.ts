import { describe, expect, it } from 'vitest';
import { xtreamFixtures } from '@/test/msw';
import { parseAuthResponse, toBool, toEpochMs, toInt, toStringList, toText } from './schemas';

describe('coercion helpers', () => {
  it.each([
    [12, 12],
    ['12', 12],
    [' 12 ', 12],
    ['12.9', 12],
    ['-3', -3],
    ['', undefined],
    ['abc', undefined],
    ['12abc', undefined],
    [null, undefined],
    [undefined, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [true, undefined],
    [{}, undefined],
  ])('toInt(%j) → %j', (input, expected) => {
    expect(toInt(input)).toBe(expected);
  });

  it.each([
    [1, true],
    ['1', true],
    [true, true],
    ['true', true],
    [0, false],
    ['0', false],
    [false, false],
    ['FALSE', false],
    [null, undefined],
    ['', undefined],
    ['yes', undefined],
  ])('toBool(%j) → %j', (input, expected) => {
    expect(toBool(input)).toBe(expected);
  });

  it.each([
    ['1893456000', 1893456000000],
    [1893456000, 1893456000000],
    [1893456000000, 1893456000000],
    ['0', undefined],
    [0, undefined],
    [null, undefined],
    ['', undefined],
    ['null', undefined],
    ['-1', undefined],
  ])('toEpochMs(%j) → %j', (input, expected) => {
    expect(toEpochMs(input)).toBe(expected);
  });

  it.each([
    ['Active', 'Active'],
    [' Active ', 'Active'],
    [42, '42'],
    ['', undefined],
    ['null', undefined],
    [null, undefined],
    [{}, undefined],
  ])('toText(%j) → %j', (input, expected) => {
    expect(toText(input)).toBe(expected);
  });

  it.each([
    [
      ['m3u8', 'ts'],
      ['m3u8', 'ts'],
    ],
    [
      ['m3u8', null, '', 3, {}],
      ['m3u8', '3'],
    ],
    ['ts', ['ts']],
    [null, []],
    [undefined, []],
    [{}, []],
  ])('toStringList(%j) → %j', (input, expected) => {
    expect(toStringList(input)).toEqual(expected);
  });
});

describe('parseAuthResponse', () => {
  it('parses auth-ok.json (numbers as strings, exp_date seconds → ms)', () => {
    expect(parseAuthResponse(xtreamFixtures.authOk)).toEqual({
      account: {
        auth: true,
        status: 'Active',
        expiresAt: 1893456000 * 1000,
        createdAt: 1735689600 * 1000,
        isTrial: false,
        maxConnections: 2,
        activeConnections: 0,
        formats: ['m3u8', 'ts'],
      },
      server: {
        url: 'panel.example.test',
        port: 8080,
        protocol: 'http',
        timezone: 'Europe/Lisbon',
        now: 1767268800 * 1000,
      },
    });
  });

  it('reads https_port from server-info-https.json', () => {
    expect(parseAuthResponse(xtreamFixtures.serverInfoHttps)?.server?.httpsPort).toBe(8443);
  });

  it('auth-fail.json → auth false, no server', () => {
    expect(parseAuthResponse(xtreamFixtures.authFail)).toEqual({
      account: { auth: false, formats: [] },
    });
  });

  it('account-banned.json: null exp_date, empty formats', () => {
    const info = parseAuthResponse(xtreamFixtures.accountBanned);
    expect(info?.account).toMatchObject({ auth: true, status: 'Banned', formats: [] });
    expect(info?.account.expiresAt).toBeUndefined();
  });

  it('accepts numbers as numbers, nulls and missing fields, and ignores unknown fields', () => {
    const info = parseAuthResponse({
      user_info: {
        auth: 1,
        status: null,
        exp_date: 1893456000,
        max_connections: null,
        active_cons: 'n/a',
        allowed_output_formats: null,
        extra: { nested: true },
      },
      server_info: { https_port: 'abc', port: 70000, server_protocol: 'HTTPS', foo: 'bar' },
      unknown_top: 1,
    });
    expect(info).toEqual({
      account: { auth: true, expiresAt: 1893456000000, formats: [] },
      server: { protocol: 'https' },
    });
  });

  it('tolerates a malformed server_info', () => {
    expect(parseAuthResponse({ user_info: { auth: '1' }, server_info: 'nope' })).toEqual({
      account: { auth: true, formats: [] },
    });
    expect(
      parseAuthResponse({ user_info: { auth: '1' }, server_info: null })?.server,
    ).toBeUndefined();
  });

  it('drops negative connection counts', () => {
    const info = parseAuthResponse({
      user_info: { auth: 1, max_connections: -1, active_cons: '-2' },
    });
    expect(info?.account.maxConnections).toBeUndefined();
    expect(info?.account.activeConnections).toBeUndefined();
  });

  it.each([null, undefined, 'x', 42, [], {}, { user_info: null }, { user_info: 'x' }])(
    'returns undefined for a non-auth body %j',
    (body) => {
      expect(parseAuthResponse(body)).toBeUndefined();
    },
  );
});
