// Modelo de erros de rede (FND-06, docs/ARCHITECTURE.md §4 e §8).
// A UI mapeia `kind` → mensagem pt-PT; a `message` aqui é para diagnóstico e nunca contém credenciais.
import { MASK, redact, toLogJson } from '@/core/log';

export type NetErrorKind =
  'offline' | 'timeout' | 'aborted' | 'blocked' | 'http' | 'auth' | 'parse';

export type NetErrorHint = 'mixed-content' | 'cors';

export interface NetErrorInit {
  kind: NetErrorKind;
  status?: number;
  hint?: NetErrorHint;
  /** URL do pedido. Nunca é guardado: só a forma encurtada e redigida (`target`). */
  url?: string;
  cause?: unknown;
}

const DESCRIPTIONS: Record<NetErrorKind, string> = {
  offline: 'Sem ligação à rede',
  timeout: 'Tempo de espera esgotado',
  aborted: 'Pedido cancelado',
  blocked: 'Pedido bloqueado pelo browser',
  http: 'Resposta HTTP inesperada',
  auth: 'Autenticação recusada',
  parse: 'Resposta inválida',
};

/** Primeiros segmentos conhecidos (endpoints Xtream e tipos de stream) que podem ficar visíveis. */
const SAFE_FIRST_SEGMENTS = new Set([
  'player_api.php',
  'get.php',
  'xmltv.php',
  'live',
  'movie',
  'series',
  'timeshift',
]);
const EXTENSION = /\.([A-Za-z0-9]{1,5})$/;

// Encurta um URL para diagnóstico. Regra: o host (com porta e userinfo) passa a `***`; a query e o
// fragmento são descartados; do caminho só fica o primeiro segmento se for conhecido
// (`SAFE_FIRST_SEGMENTS`) e a extensão do último segmento — todos os outros segmentos passam a `***`.
// Exemplos (comentário de linha porque `***/` fecharia um bloco /** */):
//   http://h:8080/player_api.php?username=… → http://***/player_api.php
//   http://h/live/u/p/1.ts                  → http://***/live/***/***/***.ts
//   http://h/u/p/1.ts                       → http://***/***/***/***.ts
export function shortenUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!parsed.host) return `${parsed.protocol}${MASK}`;
  const segments = parsed.pathname.split('/').slice(1);
  const masked = segments.map((segment, i) => {
    if (segment === '') return '';
    if (i === 0 && SAFE_FIRST_SEGMENTS.has(segment.toLowerCase())) return segment;
    const ext = i === segments.length - 1 ? EXTENSION.exec(segment) : null;
    return ext ? `${MASK}.${ext[1]}` : MASK;
  });
  return redact(`${parsed.protocol}//${MASK}/${masked.join('/')}`);
}

const MAX_CAUSE_DEPTH = 3;

/**
 * A causa original pode trazer o URL completo na mensagem: guarda-se só uma cópia redigida,
 * incluindo a cadeia de `cause` até `MAX_CAUSE_DEPTH` níveis.
 */
function sanitizeCause(cause: unknown, depth = 1): unknown {
  if (cause === undefined || depth > MAX_CAUSE_DEPTH) return undefined;
  if (cause instanceof Error) {
    const inner = sanitizeCause((cause as { cause?: unknown }).cause, depth + 1);
    const copy = new Error(
      redact(cause.message),
      inner !== undefined ? { cause: inner } : undefined,
    );
    copy.name = cause.name;
    copy.stack = cause.stack !== undefined ? redact(cause.stack) : undefined;
    return copy;
  }
  if (cause !== null && typeof cause === 'object') return toLogJson(cause);
  return redact(String(cause));
}

export class NetError extends Error {
  override readonly name = 'NetError';
  readonly kind: NetErrorKind;
  readonly status?: number;
  readonly hint?: NetErrorHint;
  /** URL encurtado e redigido (esquema + `***` + caminho, sem query). */
  readonly target?: string;

  constructor({ kind, status, hint, url, cause }: NetErrorInit) {
    const target = url !== undefined ? shortenUrl(url) : undefined;
    const parts = [`${DESCRIPTIONS[kind]} (${kind}`];
    if (status !== undefined) parts.push(`, HTTP ${status}`);
    if (hint !== undefined) parts.push(`, ${hint}`);
    parts.push(')');
    if (target !== undefined) parts.push(`: ${target}`);
    const safeCause = sanitizeCause(cause);
    super(parts.join(''), safeCause !== undefined ? { cause: safeCause } : undefined);
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (hint !== undefined) this.hint = hint;
    if (target !== undefined) this.target = target;
  }
}

export function isNetError(e: unknown): e is NetError {
  return e instanceof NetError;
}
