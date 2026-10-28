// Redação central de credenciais (FND-06, docs/ARCHITECTURE.md §8, docs/SECURITY.md).
// Tudo o que sai para a consola, mensagens de erro ou relatórios de diagnóstico passa por aqui.

export const MASK = '***';

/** Segredos com menos caracteres do que isto são ignorados para não destruir texto comum. */
const MIN_SECRET_LENGTH = 3;

/** Palavras sensíveis; casam como nome completo ou sufixo (`api_key`, `access-token`, `accessToken`). */
const SENSITIVE_WORDS = ['authorization', 'username', 'password', 'token', 'pass', 'auth', 'key'];

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

/**
 * Decide se um nome de parâmetro/campo é sensível: termina numa palavra sensível que começa numa
 * fronteira — início do nome, depois de `_`/`-`, ou início de palavra camelCase (`apiKey`).
 * Assim `passport`, `bypass`, `monkey` e `keyboard` não casam; `APIKEY` (sem fronteira) também não.
 */
function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (!lower.endsWith(word)) continue;
    const i = name.length - word.length;
    if (i === 0) return true;
    const prev = name.charAt(i - 1);
    if (prev === '_' || prev === '-') return true;
    if (isUpper(name.charAt(i)) && !isUpper(prev)) return true;
  }
  return false;
}

/**
 * Nome de parâmetro seguido de `=` ou `%3D`. O lookbehind faz a pesquisa arrancar só no início de
 * cada nome (custo linear). `%26password` aparece como nome `26password` precedido de `%`.
 */
const PARAM_NAME = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+)(=|%3D)/gi;
/** Valor após `=`: termina em `&`, `#`, espaço, aspas ou fim de texto. */
const PLAIN_VALUE = /[^&#\s"'<>]*/y;
/** Valor após `%3D` (URL dentro de outro parâmetro): termina também em `%26`. */
const ENCODED_VALUE = /(?:(?!%26)[^&#\s"'<>])*/y;

function redactParams(text: string): string {
  let out = '';
  let last = 0;
  PARAM_NAME.lastIndex = 0;
  for (let m = PARAM_NAME.exec(text); m; m = PARAM_NAME.exec(text)) {
    let name = m[1] ?? '';
    if (text.charAt(m.index - 1) === '%' && /^(?:26|3F|2B)/i.test(name)) name = name.slice(2);
    if (!isSensitiveName(name)) continue;
    const valueStart = m.index + m[0].length;
    const valueRe = m[2] === '=' ? PLAIN_VALUE : ENCODED_VALUE;
    valueRe.lastIndex = valueStart;
    valueRe.exec(text);
    out += text.slice(last, valueStart) + MASK;
    last = Math.max(valueRe.lastIndex, valueStart);
    PARAM_NAME.lastIndex = last;
  }
  return out + text.slice(last);
}

/** Chave JSON `"nome":` — o valor (string, número, literal, objeto ou array) é delimitado à mão. */
const JSON_KEY = /"([A-Za-z0-9_-]+)"\s*:\s*/g;
const JSON_PRIMITIVE = /[^,}\]\s]*/y;

/** Fim do valor JSON que começa em `start` (tolerante: texto truncado vai até ao fim). */
function jsonValueEnd(text: string, start: number): number {
  const c = text.charAt(start);
  if (c === '"') {
    let i = start + 1;
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
    return Math.min(i + 1, text.length);
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const ch = text.charAt(i);
      if (ch === '"') {
        i = jsonValueEnd(text, i);
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      i++;
      if (depth === 0) return i;
    }
    return text.length;
  }
  JSON_PRIMITIVE.lastIndex = start;
  JSON_PRIMITIVE.exec(text);
  return JSON_PRIMITIVE.lastIndex;
}

/** `"password":"abc"`, `"pin":1234`, `"apiKey":{…}` → o valor inteiro passa a `"***"`. */
function redactJsonFields(text: string): string {
  let out = '';
  let last = 0;
  JSON_KEY.lastIndex = 0;
  for (let m = JSON_KEY.exec(text); m; m = JSON_KEY.exec(text)) {
    if (!isSensitiveName(m[1] ?? '')) continue;
    const valueStart = m.index + m[0].length;
    const valueEnd = jsonValueEnd(text, valueStart);
    if (valueEnd <= valueStart) continue;
    out += text.slice(last, valueStart) + `"${MASK}"`;
    last = valueEnd;
    JSON_KEY.lastIndex = last;
  }
  return out + text.slice(last);
}

/** Cabeçalho `Authorization: Basic …` em texto livre e tokens `Bearer …`. */
const AUTH_HEADER =
  /(?<![A-Za-z0-9_-])((?:proxy-)?authorization\s*:\s*)(?:(basic|bearer|digest|token)\s+)?[^\s"'<>,;]+/gi;
const BEARER = /(?<![A-Za-z0-9_-])(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/** Caminhos de stream Xtream: `/live/<user>/<pass>/` (e a forma com `%2F`). */
const XTREAM_PATH = /\/(live|movie|series|timeshift)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\//gi;
const XTREAM_PATH_ENCODED =
  /%2F(live|movie|series|timeshift)%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F/gi;

/**
 * Caminho Xtream "nu" (saída típica de get.php): `scheme://host/<user>/<pass>/<id>.<ext>`, com o
 * caminho exatamente nesta forma. Pode redigir URLs inócuos com a mesma forma — aceitável em logs.
 */
const XTREAM_BARE =
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/?#"'<>]+)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\/(\d+(?:\.[A-Za-z0-9]+)?)(?=[\s?#"'<>]|$)/gi;
const XTREAM_BARE_ENCODED =
  /(%3A%2F%2F(?:(?!%2F)[^/\s?#&"'<>])+)%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(?:(?!%2F)[^/\s?#&"'<>])+%2F(\d+(?:\.[A-Za-z0-9]+)?)(?=%26|%3F|%23|[\s&?#"'<>]|$)/gi;

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
    new URLSearchParams({ x: value }).toString().slice(2), // application/x-www-form-urlencoded
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
  out = out
    .replace(USERINFO, `$1${MASK}@`)
    .replace(XTREAM_PATH, `/$1/${MASK}/${MASK}/`)
    .replace(XTREAM_PATH_ENCODED, `%2F$1%2F${MASK}%2F${MASK}%2F`)
    .replace(XTREAM_BARE, `$1/${MASK}/${MASK}/$2`)
    .replace(XTREAM_BARE_ENCODED, `$1%2F${MASK}%2F${MASK}%2F$2`)
    .replace(
      AUTH_HEADER,
      (_m, head: string, scheme?: string) => `${head}${scheme ? `${scheme} ` : ''}${MASK}`,
    )
    .replace(BEARER, `$1${MASK}`);
  return redactJsonFields(redactParams(out));
}
