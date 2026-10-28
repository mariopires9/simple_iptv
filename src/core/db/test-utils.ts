// core/db test utilities (not imported by app code).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openDatabase } from './database';

/** Opens the database on a new, isolated fake-indexeddb factory; also returns the factory. */
export async function openFreshDatabase() {
  const factory = new IDBFactory();
  const db = await openDatabase({ indexedDB: factory, IDBKeyRange });
  return { db, factory };
}
