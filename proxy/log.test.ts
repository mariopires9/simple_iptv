// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLogger, errorCode, sanitizeLogFields, type LogFields } from './log.ts';

describe('proxy logger', () => {
  it('keeps only whitelisted fields with safe values', () => {
    const fields = {
      event: 'request',
      status: 200,
      code: 'host-not-allowed',
      durationMs: 12.6,
      bytes: 100,
      url: 'http://panel.example.com/live/u/p/1.ts',
      host: 'panel.example.com',
      token: 'x'.repeat(43),
    } as LogFields;
    expect(sanitizeLogFields(fields)).toEqual({
      event: 'request',
      status: 200,
      code: 'host-not-allowed',
      durationMs: 13,
      bytes: 100,
    });
  });

  it('drops codes that could carry a host, path or URL', () => {
    for (const code of ['panel.example.com', '/live/1.ts', 'http://a', 'a b', 'x'.repeat(80)]) {
      expect(sanitizeLogFields({ event: 'request', code })).toEqual({ event: 'request' });
    }
    expect(sanitizeLogFields({ event: 'nope' as LogFields['event'] })).toBeNull();
  });

  it('reduces errors to their code or name', () => {
    expect(
      errorCode(
        Object.assign(new Error('getaddrinfo ENOTFOUND panel.example.com'), { code: 'ENOTFOUND' }),
      ),
    ).toBe('ENOTFOUND');
    expect(errorCode(new TypeError('Invalid URL http://secret'))).toBe('TypeError');
    expect(errorCode({ code: 'http://secret', name: 'x.y' })).toBe('Error');
    expect(errorCode('string')).toBe('Error');
  });

  it('writes JSON lines, errors to the error sink', () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = createLogger({ out: (l) => out.push(l), err: (l) => err.push(l) });
    logger.log({ event: 'startup', port: 8787, allowedHosts: 2, allowedOrigins: 3 });
    logger.log({ event: 'upstream-error', code: 'ECONNRESET' });
    expect(JSON.parse(out[0] ?? '')).toMatchObject({
      event: 'startup',
      port: 8787,
      allowedHosts: 2,
    });
    expect(JSON.parse(err[0] ?? '')).toMatchObject({ event: 'upstream-error', code: 'ECONNRESET' });
  });
});
