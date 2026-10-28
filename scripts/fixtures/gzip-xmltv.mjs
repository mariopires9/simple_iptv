#!/usr/bin/env node
// Gzips an XMLTV fixture deterministically (QA-01).
//
//   node scripts/fixtures/gzip-xmltv.mjs [in] [out]
//   defaults: fixtures/xmltv/small.xml -> fixtures/xmltv/small.xml.gz
//
// The gzip header MTIME is 0 (zlib default) and the OS byte is pinned to 3 (Unix),
// so the output is byte-identical on every platform for a given Node/zlib version.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @param {Uint8Array} input */
export function gzipDeterministic(input) {
  const out = gzipSync(input, { level: 9 });
  out[9] = 3;
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const input = process.argv[2] ?? `${root}fixtures/xmltv/small.xml`;
  const output = process.argv[3] ?? `${input}.gz`;
  const gz = gzipDeterministic(readFileSync(input));
  writeFileSync(output, gz);
  process.stdout.write(`${output} (${gz.length} bytes)\n`);
}
