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
  it('redige mensagem e contexto antes da consola e do buffer', () => {
    registerSecret('s3gr3d0');
    log.error('Falha em http://h.test/live/joao/abc/1.ts', {
      url: 'http://h.test/get.php?username=joao&password=abc',
      extra: 'valor s3gr3d0',
    });

    const [entry] = getLogEntries();
    expect(entry?.level).toBe('error');
    expect(entry?.message).toBe('Falha em http://h.test/live/***/***/1.ts');
    expect(entry?.context).toBe(
      '{"url":"http://h.test/get.php?username=***&password=***","extra":"valor ***"}',
    );

    const printed = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(printed).not.toMatch(/joao|abc|s3gr3d0/);
  });

  it('serializa Error (name/message/stack/cause) e redige-o', () => {
    registerSecret('s3gr3d0');
    const err = new Error('pedido a http://h.test/?password=abc', {
      cause: new TypeError('s3gr3d0'),
    });
    log.warn('erro', { err });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"name":"Error"');
    expect(context).toContain('"stack":');
    expect(context).toContain('password=***');
    expect(context).toContain('"cause":{"name":"TypeError","message":"***"');
    expect(context).not.toMatch(/abc|s3gr3d0/);
  });

  it('suporta referências circulares e bigint', () => {
    const a: Record<string, unknown> = { n: 1n };
    a.self = a;
    log.info('ciclo', { a });
    expect(getLogEntries()[0]?.context).toBe('{"a":{"n":"1","self":"[Circular]"}}');
  });

  it('escreve na consola do nível correspondente', () => {
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(console.debug).toHaveBeenCalledWith('[debug] d');
    expect(console.info).toHaveBeenCalledWith('[info] i');
    expect(console.warn).toHaveBeenCalledWith('[warn] w');
    expect(console.error).toHaveBeenCalledWith('[error] e');
  });

  it('debug fica silencioso em produção mas continua no buffer', () => {
    vi.stubEnv('PROD', true);
    try {
      log.debug('só no buffer');
      expect(console.debug).not.toHaveBeenCalled();
      expect(getLogEntries()[0]?.message).toBe('só no buffer');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('o buffer circular guarda no máximo 500 entradas (as mais recentes)', () => {
    for (let i = 0; i < LOG_BUFFER_SIZE + 120; i++) log.info(`entrada ${i}`);
    const entries = getLogEntries();
    expect(LOG_BUFFER_SIZE).toBe(500);
    expect(entries).toHaveLength(500);
    expect(entries[0]?.message).toBe('entrada 120');
    expect(entries.at(-1)?.message).toBe(`entrada ${LOG_BUFFER_SIZE + 119}`);
    expect(exportDiagnostics()).toContain('Entradas: 500');
  });

  it('clearLogBuffer esvazia o buffer', () => {
    log.info('x');
    clearLogBuffer();
    expect(getLogEntries()).toHaveLength(0);
  });
});

describe('exportDiagnostics', () => {
  it('produz texto com timestamps ISO, nível, mensagem e contexto', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 28, 12, 0, 0));
    log.warn('aviso', { n: 1 });
    const report = exportDiagnostics();
    expect(report).toContain('Relatório de diagnóstico');
    expect(report).toContain('2026-10-28T12:00:00.000Z WARN  aviso');
    expect(report).toContain('    contexto: {"n":1}');
  });

  it('aplica os mesmos filtros, incluindo segredos registados depois do log', () => {
    log.info('palavra tardia: t4rd10');
    expect(exportDiagnostics()).toContain('t4rd10');
    registerSecret('t4rd10');
    const report = exportDiagnostics();
    expect(report).not.toContain('t4rd10');
    expect(report).toBe(redact(report));
  });
});

describe('propriedade: segredos aleatórios nunca sobrevivem', () => {
  // PRNG determinístico (mulberry32) para resultados reprodutíveis sem dependências novas.
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
    (u, p) => `texto livre ${u} e ${p}.`,
  ];

  it('200 segredos registados não aparecem em redact nem em exportDiagnostics', () => {
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

describe('regressões da revisão', () => {
  it('Error com ciclo (e.cause = e) não perde o contexto', () => {
    const e = new Error('ciclo');
    (e as { cause?: unknown }).cause = e;
    log.error('x', { e });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"message":"ciclo"');
    expect(context).toContain('"cause":"[Circular]"');
  });

  it('Errors A↔B não perdem o contexto', () => {
    const a = new Error('A');
    const b = new Error('B', { cause: a });
    (a as { cause?: unknown }).cause = b;
    log.error('x', { a });
    const context = getLogEntries()[0]?.context ?? '';
    expect(context).toContain('"message":"B"');
    expect(context).toContain('"cause":"[Circular]"');
  });

  it('referências partilhadas não cíclicas são serializadas em ambos os sítios', () => {
    const s = { v: 1 };
    log.info('x', { a: s, b: s, list: [s, s] });
    expect(getLogEntries()[0]?.context).toBe('{"a":{"v":1},"b":{"v":1},"list":[{"v":1},{"v":1}]}');
  });

  it('o cabeçalho do relatório não é estragado por segredos curtos', () => {
    registerSecret('IPTV');
    registerSecret('Gerado');
    log.info('serviço IPTV');
    const report = exportDiagnostics();
    expect(report.startsWith('Relatório de diagnóstico — Simple IPTV\nGerado em: ')).toBe(true);
    expect(report).toContain('INFO  serviço ***');
  });

  it('toLogJson nunca lança e redige', () => {
    expect(toLogJson({ password: 'abc', n: 1n })).toBe('{"password":"***","n":"1"}');
    expect(toLogJson(undefined)).toBe('undefined');
  });
});
