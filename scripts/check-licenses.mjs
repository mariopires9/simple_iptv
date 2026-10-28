// Verifica as licenças das dependências de produção (as que são distribuídas no bundle) — FND-02, docs/SECURITY.md §5.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'OFL-1.1',
  '0BSD',
  'CC0-1.0',
];

/** Aceita expressões SPDX simples: "MIT", "(MIT OR Apache-2.0)". AND exige todas permitidas. */
export function isAllowed(license) {
  if (typeof license !== 'string' || license.trim() === '') return false;
  const expr = license.replace(/[()]/g, '').trim();
  if (expr.includes(' AND ')) return expr.split(' AND ').every((l) => ALLOWED.includes(l.trim()));
  return expr.split(' OR ').some((l) => ALLOWED.includes(l.trim()));
}

export function findViolations(packages) {
  return packages.filter((p) => !isAllowed(p.license));
}

function productionPackages() {
  const out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    encoding: 'utf8',
  });
  const dirs = out.split('\n').filter((d) => d.includes('node_modules'));
  return [...new Set(dirs)].map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
    return { name: `${pkg.name}@${pkg.version}`, license };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pkgs = productionPackages();
  const bad = findViolations(pkgs);
  if (bad.length > 0) {
    for (const p of bad)
      process.stderr.write(`Licença não permitida: ${p.name} (${p.license ?? 'sem licença'})\n`);
    process.exit(1);
  }
  process.stdout.write(`Licenças ok: ${pkgs.length} pacotes de produção.\n`);
}
