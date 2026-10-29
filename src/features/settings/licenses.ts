// Client side of the build-time licenses list (UX-04 AC2, build/licenses.ts): fetched only when
// the user opens it, so it is never part of the initial bundle. Same origin, no credentials.
// The file comes from our own build, but it is still parsed defensively (wrong shape → error).

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
}

/** Published next to index.html by the build plugin. */
export const LICENSES_FILE_NAME = 'licenses.json';

function isEntry(value: unknown): value is LicenseEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.license === 'string'
  );
}

/** Loads and validates the list; rejects when it is missing (plugin not registered) or invalid. */
export async function loadLicenses(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  base: string = import.meta.env.BASE_URL,
): Promise<LicenseEntry[]> {
  const response = await fetchImpl(`${base.replace(/\/?$/, '/')}${LICENSES_FILE_NAME}`, {
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Licenses list unavailable (HTTP ${response.status})`);
  const body = (await response.json()) as { version?: unknown; packages?: unknown };
  if (body?.version !== 1 || !Array.isArray(body.packages)) {
    throw new Error('Licenses list has an unknown format');
  }
  return body.packages.filter(isEntry);
}
