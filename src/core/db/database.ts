// Abertura, fecho e eliminação da base de dados. Módulo interno de core/db:
// as features usam apenas os repositórios exportados por `./index.ts`.
//
// Nota sobre downgrade: se a base instalada tiver uma versão superior (criada por uma versão mais
// recente da app), o Dexie 4 não rejeita com VersionError — abre-a na versão existente e cria as
// tabelas em falta (fazendo upgrade de versão se necessário). Por isso não existe um motivo
// "version" em `DatabaseUnavailableReason`; um VersionError residual cai em 'open-failed'.
import { SimpleIptvDb } from './schema';

/** Motivo técnico; a UI converte-o em texto (src/i18n/pt-PT/db.ts, ADR-012). */
export type DatabaseUnavailableReason = 'unsupported' | 'open-failed' | 'timeout';

/** IndexedDB indisponível ou inacessível. A mensagem é diagnóstica (inglês), não para a UI. */
export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
  readonly reason: DatabaseUnavailableReason;

  constructor(reason: DatabaseUnavailableReason, options?: { cause?: unknown }) {
    super(`IndexedDB unavailable (${reason})`, options);
    this.reason = reason;
  }
}

/** A abertura em curso foi cancelada por `closeDatabase()`/`wipeAll()`. */
export class DatabaseClosedError extends Error {
  override readonly name = 'DatabaseClosedError';

  constructor() {
    super('Database closed while opening');
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
/** Incrementada em cada fecho/wipe: uma abertura de uma geração anterior nunca fica em `current`. */
let generation = 0;

function classify(error: unknown): DatabaseUnavailableReason {
  return error instanceof Error && error.name === 'MissingAPIError' ? 'unsupported' : 'open-failed';
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

async function doOpen(options: OpenDatabaseOptions, gen: number): Promise<SimpleIptvDb> {
  let db: SimpleIptvDb | undefined;
  try {
    db = createDb(options);
    await withTimeout(db.open(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    db?.close();
    if (gen !== generation) throw new DatabaseClosedError();
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(classify(error), { cause: error });
  }
  if (gen !== generation) {
    // Entretanto houve closeDatabase()/wipeAll(): esta ligação não pode sobreviver.
    db.close();
    throw new DatabaseClosedError();
  }
  const opened = db;
  // Fecho inesperado (ex.: outro separador apagou a base): a próxima chamada volta a abrir.
  opened.on('close', () => {
    if (current === opened) current = undefined;
  });
  current = opened;
  return opened;
}

/**
 * Abre (ou devolve já aberta) a base `simple-iptv` v1.
 * Rejeita com `DatabaseUnavailableError` se o IndexedDB não estiver disponível.
 * As opções só têm efeito na primeira abertura (ou depois de `closeDatabase()`).
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<SimpleIptvDb> {
  if (current) return Promise.resolve(current);
  if (!opening) {
    lastOptions = options;
    const promise: Promise<SimpleIptvDb> = doOpen(options, generation).finally(() => {
      if (opening === promise) opening = undefined;
    });
    opening = promise;
  }
  return opening;
}

/**
 * Fecha a ligação atual e cancela uma abertura em curso (essa ligação é fechada assim que
 * concluir e a promessa rejeita com `DatabaseClosedError`). Devolve quando nada fica aberto.
 */
export async function closeDatabase(): Promise<void> {
  generation += 1;
  const pending = opening;
  opening = undefined;
  current?.close();
  current = undefined;
  if (pending) await pending.catch(() => undefined);
}

/** Apaga toda a base de dados (SRC-10 "Apagar todos os dados"). */
export async function wipeAll(): Promise<void> {
  await closeDatabase();
  await createDb(lastOptions).delete();
}

/** Usado pelos repositórios: abre a base se ainda não estiver aberta. */
export function getDb(): Promise<SimpleIptvDb> {
  return openDatabase();
}
