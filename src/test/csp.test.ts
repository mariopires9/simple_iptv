// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor, IndexHtmlTransformHook } from 'vite';
import { CONTENT_SECURITY_POLICY, CSP_DIRECTIVES, cspPlugin } from '../../build/csp.ts';

// SEC-01 AC1 + AC5.
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('Content Security Policy (SEC-01 AC1)', () => {
  const policy = directives(CONTENT_SECURITY_POLICY);

  it.each<[string, string[]]>([
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ['*', 'data:', 'blob:']],
    ['media-src', ['*', 'blob:']],
    ['connect-src', ['*']],
    ['worker-src', ["'self'", 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'none'"]],
  ])('%s is %j', (name, values) => {
    expect(policy.get(name)).toEqual(values);
  });

  it('has exactly the expected directives', () => {
    expect([...policy.keys()]).toEqual(CSP_DIRECTIVES.map(([name]) => name));
    expect(policy.size).toBe(12);
  });

  it('never allows eval, external scripts or inline scripts', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).not.toContain('wasm-unsafe-eval');
    expect(policy.get('script-src')).toEqual(["'self'"]);
  });

  it('does not upgrade insecure requests (would rewrite http:// user streams)', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('upgrade-insecure-requests');
  });

  it('does not use directives that are ignored in a <meta> policy', () => {
    for (const name of ['frame-ancestors', 'report-uri', 'sandbox']) {
      expect(policy.has(name)).toBe(false);
    }
  });

  it('is serialized as a single header-safe line', () => {
    expect(CONTENT_SECURITY_POLICY).toMatch(/^[\x20-\x7e]+$/);
    expect(CONTENT_SECURITY_POLICY).not.toContain('"');
  });
});

describe('cspPlugin', () => {
  const plugin = cspPlugin();

  it('only applies to production builds (the dev server needs inline scripts)', () => {
    expect(plugin.apply).toBe('build');
  });

  it('prepends the CSP meta to <head>', async () => {
    const hook = plugin.transformIndexHtml as { handler: IndexHtmlTransformHook };
    const tags = (await hook.handler.call(
      {} as never,
      indexHtml,
      {} as never,
    )) as HtmlTagDescriptor[];
    expect(tags).toEqual([
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ]);
  });
});

describe('index.html (SEC-01 AC5)', () => {
  it('sets referrer policy no-referrer', () => {
    expect(indexHtml).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
  });

  it('has no inline scripts (only external module scripts)', () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs = '', body = ''] of scripts) {
      expect(attrs).toMatch(/\btype="module"/);
      expect(attrs).toMatch(/\bsrc="/);
      expect(body.trim()).toBe('');
    }
  });

  it('has no inline event handlers', () => {
    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
