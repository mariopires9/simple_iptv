// Modelo de erros de rede (FND-06, docs/ARCHITECTURE.md §4 e §8).
// A UI mapeia `kind` → mensagem pt-PT; a `message` aqui é para diagnóstico e nunca contém credenciais.
import { MASK, redact } from '@/core/log';

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

// `http://user:pass@host:8080/player_api.php?username=…` → `http://***/player_api.php`.
export function shortenUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!parsed.host) return `${parsed.protocol}${MASK}`;
  return redact(`${parsed.protocol}//${MASK}${parsed.pathname}`);
}

/** A causa original pode trazer o URL completo na mensagem: guarda-se só uma cópia redigida. */
function sanitizeCause(cause: unknown): unknown {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) {
    const copy = new Error(redact(cause.message));
    copy.name = cause.name;
    copy.stack = cause.stack !== undefined ? redact(cause.stack) : undefined;
    return copy;
  }
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
