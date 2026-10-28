import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, redact, registerSecret, unregisterSecret } from './redact';

// Dados fictícios: nunca usar credenciais reais em testes (CLAUDE.md).
afterEach(() => {
  clearSecrets();
});

describe('redact — parâmetros de query', () => {
  it('redige os exemplos do CA1', () => {
    expect(redact('password=abc')).toBe('password=***');
    expect(redact('username=joao')).toBe('username=***');
  });

  it('redige um URL da API Xtream', () => {
    expect(
      redact(
        'http://exemplo.test:8080/player_api.php?username=joao&password=abc&action=get_live_streams',
      ),
    ).toBe(
      'http://exemplo.test:8080/player_api.php?username=***&password=***&action=get_live_streams',
    );
  });

  it('redige um URL M3U get.php', () => {
    expect(
      redact('http://exemplo.test/get.php?username=joao&password=abc&type=m3u_plus&output=ts'),
    ).toBe('http://exemplo.test/get.php?username=***&password=***&type=m3u_plus&output=ts');
  });

  it('redige pass, token, auth e key, incluindo prefixos como api_key', () => {
    expect(redact('?pass=p1&token=t1&auth=a1&key=k1&api_key=k2&access-token=t2')).toBe(
      '?pass=***&token=***&auth=***&key=***&api_key=***&access-token=***',
    );
  });

  it('ignora maiúsculas/minúsculas no nome do parâmetro', () => {
    expect(redact('?UserName=joao&PASSWORD=abc&Token=xyz')).toBe(
      '?UserName=***&PASSWORD=***&Token=***',
    );
  });

  it('redige parâmetros URL-encoded (URL dentro de outro parâmetro)', () => {
    const inner = encodeURIComponent(
      'http://exemplo.test/get.php?username=joao&password=abc&type=m3u',
    );
    const out = redact(`https://proxy.test/?url=${inner}`);
    expect(out).not.toContain('joao');
    expect(out).not.toContain('abc');
    expect(out).toContain('username%3D***%26password%3D***%26type%3Dm3u');
  });

  it('redige o valor inteiro mesmo com caracteres codificados', () => {
    expect(redact('password=a%26b%20c&x=1')).toBe('password=***&x=1');
  });

  it('redige campos JSON com nomes sensíveis', () => {
    expect(redact('{"username":"joao","password":"a\\"bc","name":"Canal"}')).toBe(
      '{"username":"***","password":"***","name":"Canal"}',
    );
  });

  it('não confunde nomes parecidos (passport, bypass, monkey)', () => {
    const text = 'passport=1&bypass=2&monkey=3&keyboard=4';
    expect(redact(text)).toBe(text);
  });
});

describe('redact — caminhos de stream Xtream', () => {
  it.each(['live', 'movie', 'series', 'timeshift'])('redige /%s/<user>/<pass>/', (type) => {
    expect(redact(`http://exemplo.test:8080/${type}/joao/abc/1.ts`)).toBe(
      `http://exemplo.test:8080/${type}/***/***/1.ts`,
    );
  });

  it('redige o exemplo do CA1', () => {
    expect(redact('/live/joao/abc/1.ts')).toBe('/live/***/***/1.ts');
  });

  it('redige timeshift com segmentos extra', () => {
    expect(redact('/timeshift/joao/abc/60/2026-01-01:10-00/42.ts')).toBe(
      '/timeshift/***/***/60/2026-01-01:10-00/42.ts',
    );
  });

  it('redige caminhos codificados com %2F', () => {
    expect(redact('url=http%3A%2F%2Fh.test%2Flive%2Fjoao%2Fabc%2F1.ts')).toBe(
      'url=http%3A%2F%2Fh.test%2Flive%2F***%2F***%2F1.ts',
    );
  });
});

describe('redact — userinfo', () => {
  it('redige scheme://user:pass@host', () => {
    expect(redact('http://joao:abc@exemplo.test:8080/get.php')).toBe(
      'http://***@exemplo.test:8080/get.php',
    );
    expect(redact('erro em rtmp://joao@exemplo.test/app')).toBe(
      'erro em rtmp://***@exemplo.test/app',
    );
  });
});

describe('redact — segredos registados', () => {
  it('redige um segredo registado em qualquer posição', () => {
    registerSecret('s3gr3d0');
    expect(redact('falhou com s3gr3d0 no meio')).toBe('falhou com *** no meio');
    expect(redact('xs3gr3d0x')).toBe('x***x');
  });

  it('redige a forma URL-encoded', () => {
    registerSecret('p@ss w/rd&1');
    const out = redact(`?x=${encodeURIComponent('p@ss w/rd&1')}`);
    expect(out).toBe('?x=***');
  });

  it('redige a forma base64', () => {
    registerSecret('s3gr3d0');
    expect(redact(`Authorization: Basic ${btoa('s3gr3d0')}`)).toBe('Authorization: Basic ***');
    expect(redact(`x=${btoa('s3gr3d0').replace(/=+$/, '')}`)).toBe('x=***');
  });

  it('redige base64 de segredos com caracteres não ASCII', () => {
    registerSecret('palavra-çã');
    const bytes = new TextEncoder().encode('palavra-çã');
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(redact(b64)).toBe('***');
  });

  it('ignora segredos com menos de 3 caracteres', () => {
    registerSecret('a');
    registerSecret('ab');
    expect(redact('abcabc a ab')).toBe('abcabc a ab');
  });

  it('unregisterSecret e clearSecrets deixam de redigir', () => {
    registerSecret('alfa123');
    registerSecret('beta456');
    unregisterSecret('alfa123');
    expect(redact('alfa123 beta456')).toBe('alfa123 ***');
    clearSecrets();
    expect(redact('alfa123 beta456')).toBe('alfa123 beta456');
  });

  it('segredo contido noutro não deixa restos', () => {
    registerSecret('abc');
    registerSecret('abcdef');
    expect(redact('abcdef')).toBe('***');
  });
});

describe('redact — texto sem segredos', () => {
  it.each([
    'Sincronização concluída: 1200 canais',
    'http://exemplo.test/epg.xml',
    'https://exemplo.test/player_api.php?action=get_live_categories',
    '/live/1.ts',
    'a=b&c=d',
    '',
  ])('mantém "%s" inalterado', (text) => {
    expect(redact(text)).toBe(text);
  });

  it('é idempotente', () => {
    const once = redact('http://joao:abc@h.test/live/joao/abc/1.ts?password=abc');
    expect(redact(once)).toBe(once);
  });
});

describe('redact — desempenho', () => {
  // Regressão: padrões que arrancavam em cada `-`, `_` ou `.` tinham custo quadrático (~1 s para 80 KB).
  it.each(['a-', 'a_', 'b.', '"a-', '%2Flive%2F'])(
    'texto longo com "%s" repetido é linear',
    (unit) => {
      const text = unit.repeat(40_000) + '=x';
      const start = performance.now();
      redact(text);
      expect(performance.now() - start).toBeLessThan(250);
    },
  );
});
