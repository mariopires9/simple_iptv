// Redação central de credenciais (FND-06, docs/ARCHITECTURE.md §8, docs/SECURITY.md).
// Tudo o que sai para a consola, mensagens de erro ou relatórios de diagnóstico passa por aqui.

export const MASK = '***';

/** Segredos com menos caracteres do que isto são ignorados para não destruir texto comum. */
const MIN_SECRET_LENGTH = 3;

const PARAM_NAMES = 'username|password|pass|token|auth|key';

// Início do nome do parâmetro: início do texto, carácter fora de [A-Za-z0-9_-] ou separador codificado
// (%26 = '&', %3F = '?', %2B = '+'). Aceita prefixos como `api_key` ou `access-token`.
// `_` e `-` ficam fora do início para a pesquisa só arrancar nas fronteiras do nome (evita custo quadrático).
const PARAM_PREFIX = `(^|[^A-Za-z0-9_-]|%26|%3F|%2B)((?:[A-Za-z0-9]+[_-])*(?:${PARAM_NAMES}))`;

/** `password=abc` — o valor termina em `&`, `#`, espaço, aspas ou fim de texto. */
const QUERY_PARAM = new RegExp(`${PARAM_PREFIX}=[^&#\\s"'<>]*`, 'gi');

/** `password%3Dabc` (URL dentro de outro parâmetro) — o valor termina também em `%26`. */
const ENCODED_QUERY_PARAM = new RegExp(`${PARAM_PREFIX}%3D(?:(?!%26)[^&#\\s"'<>])*`, 'gi');

/** `"password":"abc"` — contexto serializado em JSON. */
const JSON_FIELD = new RegExp(
  `("(?:[A-Za-z0-9]+[_-])*(?:${PARAM_NAMES})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  'gi',
);

/** Caminhos de stream Xtream: `/live/<user>/<pass>/` (e a forma com `%2F`). */
const XTREAM_PATH = /\/(live|movie|series|timeshift)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\//gi;
const XTREAM_PATH_ENCODED =
  /%2F(live|movie|series|timeshift)%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F/gi;

/** Userinfo em URLs: `scheme://user:pass@host`. */
const USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>]+@/gi;

/** Segredo registado → todas as formas em que pode aparecer (texto, URL-encoded, base64). */
const secrets = new Map<string, string[]>();
let sortedForms: string[] | null = null;

function toBase64(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formsOf(value: string): string[] {
  const encoded = encodeURIComponent(value);
  const base64 = toBase64(value);
  return [
    value,
    encoded,
    encoded.replace(/%20/g, '+'),
    encodeURIComponent(encoded), // duplamente codificado (URL dentro de URL)
    base64,
    base64.replace(/=+$/, ''),
    base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), // base64url
  ];
}

/** Regista um valor sensível (ex.: palavra-passe) para ser removido de qualquer texto. */
export function registerSecret(value: string): void {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return;
  secrets.set(value, formsOf(value));
  sortedForms = null;
}

export function unregisterSecret(value: string): void {
  if (secrets.delete(value)) sortedForms = null;
}

export function clearSecrets(): void {
  secrets.clear();
  sortedForms = null;
}

function secretForms(): string[] {
  if (!sortedForms) {
    const all = new Set<string>();
    for (const forms of secrets.values()) {
      for (const form of forms) if (form.length >= MIN_SECRET_LENGTH) all.add(form);
    }
    // Mais longos primeiro, para que um segredo contido noutro não deixe restos.
    sortedForms = [...all].sort((a, b) => b.length - a.length);
  }
  return sortedForms;
}

/** Substitui credenciais conhecidas e padrões de credenciais por `***`. Idempotente. */
export function redact(text: string): string {
  let out = String(text);
  for (const form of secretForms()) {
    if (out.includes(form)) out = out.split(form).join(MASK);
  }
  return out
    .replace(USERINFO, `$1${MASK}@`)
    .replace(XTREAM_PATH, `/$1/${MASK}/${MASK}/`)
    .replace(XTREAM_PATH_ENCODED, `%2F$1%2F${MASK}%2F${MASK}%2F`)
    .replace(ENCODED_QUERY_PARAM, `$1$2%3D${MASK}`)
    .replace(QUERY_PARAM, `$1$2=${MASK}`)
    .replace(JSON_FIELD, `$1"${MASK}"`);
}
