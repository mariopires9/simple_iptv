// @vitest-environment node
// API pública de core/db (FND-05 CA2): só repositórios, tipos e helpers — nunca a instância Dexie.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from './index';

const SRC = join(import.meta.dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('core/db — API pública', () => {
  it('exporta os repositórios tipados e não expõe a base de dados', () => {
    for (const repo of [
      'sourcesRepo',
      'catalogRepo',
      'favoritesRepo',
      'historyRepo',
      'settingsRepo',
    ]) {
      expect(api).toHaveProperty(repo);
    }
    for (const forbidden of ['getDb', 'SimpleIptvDb', 'db', 'SCHEMA_V1']) {
      expect(api).not.toHaveProperty(forbidden);
    }
    expect(typeof api.openDatabase).toBe('function');
    expect(typeof api.wipeAll).toBe('function');
    expect(typeof api.itemKey).toBe('function');
  });

  it('nenhum ficheiro fora de src/core/db usa Dexie, db.table() ou módulos internos de core/db', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !relative(SRC, f).startsWith(join('core', 'db')))
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return /from ['"]dexie['"]|\.table\(|from ['"]@\/core\/db\//.test(text);
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
