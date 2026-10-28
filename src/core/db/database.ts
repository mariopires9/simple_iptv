// Abertura, fecho e eliminação da base de dados. Módulo interno de core/db:
// as features usam apenas os repositórios exportados por `./index.ts`.
import { SimpleIptvDb } from './schema';

export type DatabaseUnavailableReason = 'unsupported' | 'open-failed' | 'version' | 'timeout';

const USER_MESSAGES: Record<DatabaseUnavailableReason, string> = {
  unsupported:
    'Este browser não permite guardar dados no dispositivo. Se estiver em navegação privada, abra a app numa janela normal.',
  'open-failed':
    'Não foi possível aceder ao armazenamento do dispositivo. Se estiver em navegação privada, abra a app numa janela normal ou permita que este site guarde dados.',
  version:
    'Os dados guardados foram criados por uma versão mais recente da app. Atualize a página para obter a versão mais recente.',
  timeout:
    'O armazenamento do dispositivo não respondeu. Feche outros separadores com a app e tente novamente.',
};

/** IndexedDB indisponível ou inacessível. `userMessage` está pronta a mostrar (pt-PT). */
export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
  readonly reason: DatabaseUnavailableReason;
  readonly userMessage: string;

  constructor(reason: DatabaseUnavailableReason, options?: { cause?: unknown }) {
    super(`IndexedDB indisponível (${reason})`, options);
    this.reason = reason;
    this.userMessage = USER_MESSAGES[reason];
  }
}

export interface OpenDatabaseOptions {
  /** Fábrica alternativa (testes com fake-indexeddb). Por omissão usa `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  /** Tempo máximo de abertura (ms) antes de desistir. Por omissão 10 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

let current: SimpleIptvDb | undefined;
let lastOptions: OpenDatabaseOptions = {};
let opening: Promise<SimpleIptvDb> | undefined;

function classify(error: unknown): DatabaseUnavailableReason {
  const name = error instanceof Error ? error.name : '';
  const inner =
    error instanceof Error && 'inner' in error && error.inner instanceof Error
      ? error.inner.name
      : '';
  if (name === 'MissingAPIError') return 'unsupported';
  if (name === 'VersionError' || inner === 'VersionError') return 'version';
  return 'open-failed';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DatabaseUnavailableError('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function createDb(options: OpenDatabaseOptions): SimpleIptvDb {
  if (options.indexedDB === undefined) return new SimpleIptvDb();
  return new SimpleIptvDb({
    indexedDB: options.indexedDB,
    ...(options.IDBKeyRange ? { IDBKeyRange: options.IDBKeyRange } : {}),
  });
}

async function doOpen(options: OpenDatabaseOptions): Promise<SimpleIptvDb> {
  let db: SimpleIptvDb | undefined;
  try {
    db = createDb(options);
    await withTimeout(db.open(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const opened = db;
    // Fecho inesperado (ex.: outro separador apagou a base): a próxima chamada volta a abrir.
    opened.on('close', () => {
      if (current === opened) current = undefined;
    });
    current = opened;
    lastOptions = options;
    return opened;
  } catch (error) {
    db?.close();
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(classify(error), { cause: error });
  }
}

/**
 * Abre (ou devolve já aberta) a base `simple-iptv` v1.
 * Rejeita com `DatabaseUnavailableError` se o IndexedDB não estiver disponível.
 * As opções só têm efeito na primeira abertura (ou depois de `closeDatabase()`).
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<SimpleIptvDb> {
  if (current) return Promise.resolve(current);
  if (!opening) {
    opening = doOpen(options).finally(() => {
      opening = undefined;
    });
  }
  return opening;
}

/** Fecha a ligação atual (a próxima chamada a um repositório volta a abrir). */
export function closeDatabase(): void {
  current?.close();
  current = undefined;
}

/** Apaga toda a base de dados (SRC-10 "Apagar todos os dados"). */
export async function wipeAll(): Promise<void> {
  const db = current ?? createDb(lastOptions);
  current = undefined;
  await db.delete();
}

/** Usado pelos repositórios: abre a base se ainda não estiver aberta. */
export function getDb(): Promise<SimpleIptvDb> {
  return openDatabase();
}
