// Utilitários de teste de core/db (não importado pelo código da app).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openDatabase } from './database';

/** Abre a base numa fábrica fake-indexeddb nova e isolada; devolve também a fábrica. */
export async function openFreshDatabase() {
  const factory = new IDBFactory();
  const db = await openDatabase({ indexedDB: factory, IDBKeyRange });
  return { db, factory };
}
