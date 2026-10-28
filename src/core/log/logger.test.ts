import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_BUFFER_SIZE,
  clearLogBuffer,
  exportDiagnostics,
  getLogEntries,
  log,
  toLogJson,
} from './logger';
import { clearSecrets, redact, registerSecret } from './redact';

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  clearLogBuffer();
  clearSecrets();
});

describe('log', () => {
  it('redacts message and context before the console and the buffer', () => {
    registerSecret('s3gr3d0');
    log.error('Failure at http://h.test/live/joao/abc/1.ts', {
      url: 'http://h.test/get.php?username=joao&password=abc',
      extra: 'value s3gr3d0',
    });

    const [entry] = getLogEntries();
    expect(entry?.level).toBe('error');
    expect(entry?.message).toBe('Failure at http://h.test/live/***/***/1.ts');
    expect(entry?.context).toBe(
      '{"url":"http://h.test/get.php?username=***&password=***","extra":"value ***"}',
    );

    const printed = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(printed).not.toMatch(/joao|abc|s3gr3d0/);
  });

  it('serializes Error (name/message/stack/cause) and redacts it', () => {
    registerSecret('s3gr3d0');
    const err = new Error('request to http://h.test/?password=abc', {
      cause: new TypeError('s3gr3d0'),
    });
    log.warn('error', { err });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"name":"Error"');
    expect(context).toContain('"stack":');
    expect(context).toContain('password=***');
    expect(context).toContain('"cause":{"name":"TypeError","message":"***"');
    expect(context).not.toMatch(/abc|s3gr3d0/);
  });

  it('supports circular references and bigint', () => {
    const a: Record<string, unknown> = { n: 1n };
    a.self = a;
    log.info('cycle', { a });
    expect(getLogEntries()[0]?.context).toBe('{"a":{"n":"1","self":"[Circular]"}}');
  });

  it('writes to the console method of the matching level', () => {
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(console.debug).toHaveBeenCalledWith('[debug] d');
    expect(console.info).toHaveBeenCalledWith('[info] i');
    expect(console.warn).toHaveBeenCalledWith('[warn] w');
    expect(console.error).toHaveBeenCalledWith('[error] e');
  });

  it('debug is silent in production but still goes to the buffer', () => {
    vi.stubEnv('PROD', true);
    try {
      log.debug('buffer only');
      expect(console.debug).not.toHaveBeenCalled();
      expect(getLogEntries()[0]?.message).toBe('buffer only');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the ring buffer keeps at most 500 entries (the most recent)', () => {
    for (let i = 0; i < LOG_BUFFER_SIZE + 120; i++) log.info(`entry ${i}`);
    const entries = getLogEntries();
    expect(LOG_BUFFER_SIZE).toBe(500);
    expect(entries).toHaveLength(500);
    expect(entries[0]?.message).toBe('entry 120');
    expect(entries.at(-1)?.message).toBe(`entry ${LOG_BUFFER_SIZE + 119}`);
    expect(exportDiagnostics()).toContain('Entries: 500');
  });

  it('clearLogBuffer empties the buffer', () => {
    log.info('x');
    clearLogBuffer();
    expect(getLogEntries()).toHaveLength(0);
  });
});

describe('exportDiagnostics', () => {
  it('produces text with ISO timestamps, level, message and context', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 28, 12, 0, 0));
    log.warn('warning', { n: 1 });
    const report = exportDiagnostics();
    expect(report).toContain('Diagnostics report');
    expect(report).toContain('2026-10-28T12:00:00.000Z WARN  warning');
    expect(report).toContain('    context: {"n":1}');
  });

  it('applies the same filters, including secrets registered after logging', () => {
    log.info('late secret: t4rd10');
    expect(exportDiagnostics()).toContain('t4rd10');
    registerSecret('t4rd10');
    const report = exportDiagnostics();
    expect(report).not.toContain('t4rd10');
    expect(report).toBe(redact(report));
  });
});

describe('property: random secrets never survive', () => {
  // Deterministic PRNG (mulberry32) for reproducible results without new dependencies.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  const templates: Array<(u: string, p: string) => string> = [
    (u, p) => `http://h.test:8080/player_api.php?username=${u}&password=${p}`,
    (u, p) => `http://h.test/get.php?username=${u}&password=${p}&type=m3u_plus&output=ts`,
    (u, p) => `http://h.test/live/${u}/${p}/123.ts`,
    (u, p) => `http://h.test/movie/${u}/${p}/9.mkv`,
    (u, p) => `http://h.test/series/${u}/${p}/77.mp4`,
    (u, p) => `http://h.test/timeshift/${u}/${p}/60/2026-01-01:10-00/5.ts`,
    (u, p) => `http://${u}:${p}@h.test/`,
    (u, p) => `https://proxy.test/?url=${encodeURIComponent(`http://h.test/${u}/${p}/1.ts`)}`,
    (u, p) => `Authorization: Basic ${btoa(u)} ${btoa(p)}`,
    (u, p) => `free text ${u} and ${p}.`,
  ];

  it('200 registered secrets appear neither in redact nor in exportDiagnostics', () => {
    const rand = mulberry32(0x5eed);
    const pick = (n: number) => Math.floor(rand() * n);
    const secret = () =>
      Array.from({ length: 6 + pick(19) }, () => ALPHABET[pick(ALPHABET.length)]).join('');

    const secrets = Array.from({ length: 200 }, secret);
    secrets.forEach(registerSecret);

    for (let i = 0; i < secrets.length; i += 2) {
      const u = secrets[i] ?? '';
      const p = secrets[i + 1] ?? '';
      const template = templates[pick(templates.length)];
      const text = template ? template(u, p) : '';
      const out = redact(text);
      for (const s of [u, p, btoa(u), btoa(p)]) expect(out).not.toContain(s);
      log.info(text, { text });
    }

    const report = exportDiagnostics();
    for (const s of secrets) {
      expect(report).not.toContain(s);
      expect(report).not.toContain(btoa(s));
    }
  });
});

describe('review regressions', () => {
  it('Error with a cycle (e.cause = e) does not lose the context', () => {
    const e = new Error('cycle');
    (e as { cause?: unknown }).cause = e;
    log.error('x', { e });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"message":"cycle"');
    expect(context).toContain('"cause":"[Circular]"');
  });

  it('Errors A↔B do not lose the context', () => {
    const a = new Error('A');
    const b = new Error('B', { cause: a });
    (a as { cause?: unknown }).cause = b;
    log.error('x', { a });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"message":"B"');
    expect(context).toContain('"cause":"[Circular]"');
  });

  it('shared non-cyclic references are serialized in both places', () => {
    const s = { v: 1 };
    log.info('x', { a: s, b: s, list: [s, s] });
    expect(getLogEntries()[0]?.context).toBe('{"a":{"v":1},"b":{"v":1},"list":[{"v":1},{"v":1}]}');
  });

  it('the report header is not mangled by short secrets', () => {
    registerSecret('IPTV');
    registerSecret('Generated');
    log.info('IPTV service');
    const report = exportDiagnostics();
    expect(report.startsWith('Diagnostics report — Simple IPTV\nGenerated at: ')).toBe(true);
    expect(report).toContain('INFO  *** service');
  });

  it('toLogJson never throws and redacts', () => {
    expect(toLogJson({ password: 'abc', n: 1n })).toBe('{"password":"***","n":"1"}');
    expect(toLogJson(undefined)).toBe('undefined');
  });
});
