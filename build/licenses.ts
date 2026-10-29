import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Open-source licenses list for Settings › About (UX-04 AC2), generated at build time from the
 * production dependencies — the same set `npm run licenses` checks (scripts/check-licenses.mjs,
 * `npm ls --omit=dev`), read from package-lock.json instead of spawning npm.
 *
 * The plugin emits `licenses.json` next to index.html (and serves it from the dev server); the
 * About screen fetches it only when the user opens the list, so it never weighs on the initial
 * bundle. Without the plugin registered the file is simply missing and the screen says so.
 */

/** One production package. */
export interface LicenseEntry {
  name: string;
  version: string;
  /** SPDX expression from the lockfile (`UNKNOWN` when the package declares none). */
  license: string;
}

export interface LicensesFile {
  /** Format of this file. */
  version: 1;
  packages: LicenseEntry[];
}

export const LICENSES_FILE_NAME = 'licenses.json';

interface LockPackage {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  dev?: unknown;
  devOptional?: unknown;
  link?: unknown;
  extraneous?: unknown;
}

/**
 * Production packages of a package-lock.json (lockfileVersion 2 or 3), sorted by name.
 * Skipped: the root project, `dev` packages and `devOptional` ones (dev-or-optional peers such as
 * `typescript`, never shipped), workspace links and extraneous entries. Deduplicated by
 * name@version (a package can be installed at several paths).
 */
export function productionLicenses(lock: unknown): LicenseEntry[] {
  const packages = (lock as { packages?: unknown } | null)?.packages;
  if (typeof packages !== 'object' || packages === null) {
    throw new Error('package-lock.json without a "packages" map (lockfileVersion 2+ required)');
  }
  const entries = new Map<string, LicenseEntry>();
  for (const [path, value] of Object.entries(packages as Record<string, LockPackage>)) {
    const marker = path.lastIndexOf('node_modules/');
    if (marker === -1 || typeof value !== 'object' || value === null) continue;
    if (value.dev === true || value.devOptional === true) continue;
    if (value.link === true || value.extraneous === true) continue;
    const name = typeof value.name === 'string' ? value.name : path.slice(marker + 13);
    const version = typeof value.version === 'string' ? value.version : '';
    const license =
      typeof value.license === 'string' && value.license.trim() !== ''
        ? value.license.trim()
        : 'UNKNOWN';
    entries.set(`${name}@${version}`, { name, version, license });
  }
  return [...entries.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  );
}

/** The JSON the About screen reads. */
export function licensesFile(lock: unknown): string {
  const file: LicensesFile = { version: 1, packages: productionLicenses(lock) };
  return JSON.stringify(file);
}

export interface LicensesPluginOptions {
  /** Lockfile path; default `<root>/package-lock.json`. */
  lockfile?: string;
}

/** Vite plugin: `licenses.json` in the build output and on the dev server. */
export function licensesPlugin(options: LicensesPluginOptions = {}): Plugin {
  let lockfile = options.lockfile;
  const read = () => licensesFile(JSON.parse(readFileSync(lockfile ?? '', 'utf8')) as unknown);
  return {
    name: 'simple-iptv:licenses',
    configResolved(config) {
      lockfile ??= join(config.root, 'package-lock.json');
    },
    configureServer(server) {
      const path = `${server.config.base.replace(/\/?$/, '/')}${LICENSES_FILE_NAME}`;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== path) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(read());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LICENSES_FILE_NAME, source: read() });
    },
  };
}
