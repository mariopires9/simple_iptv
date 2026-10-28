#!/usr/bin/env node
// Generates a large, deterministic, synthetic M3U playlist for parser/performance tests (QA-01).
//
//   node scripts/fixtures/generate-m3u.mjs <count> [out] [--seed N]
//
// Without [out] the playlist is written to stdout. Same count + seed => byte-identical output.
// Output is never committed (generate it in the test or in CI); all hosts are *.example.test.
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUPS = [
  'News',
  'Sports',
  'Kids',
  'Música',
  'Documentários',
  'Movies | Action',
  'Filmes | Comédia',
  'Series | Drama',
  'Séries | Animação',
  'VOD',
];
const WORDS = [
  'Example',
  'Test',
  'Demo',
  'Sample',
  'Synthetic',
  'Canal',
  'Notícias',
  'Ação',
  'Prime',
  'One',
  'Plus',
  'HD',
  'FHD',
  '4K',
];

/**
 * Yields playlist lines (without line terminators).
 * @param {number} count number of entries
 * @param {number} [seed]
 */
export function* generateM3uLines(count, seed = 42) {
  const rng = createRng(seed);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  yield '#EXTM3U x-tvg-url="http://epg.example.test/guide.xml.gz"';
  for (let i = 1; i <= count; i++) {
    const group = pick(GROUPS);
    const isSeries = group.startsWith('Series') || group.startsWith('Séries');
    const isMovie =
      !isSeries && (group.startsWith('Movies') || group.startsWith('Filmes') || group === 'VOD');
    let name = `${pick(WORDS)} ${pick(WORDS)} ${i}`;
    let path;
    if (isSeries) {
      const s = 1 + Math.floor(rng() * 5);
      const e = 1 + Math.floor(rng() * 20);
      name += ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
      path = `series/${i}.mp4`;
    } else if (isMovie) {
      name += ` (${2000 + Math.floor(rng() * 26)})`;
      path = `movie/${i}.${rng() < 0.7 ? 'mp4' : 'mkv'}`;
    } else {
      path = `live/${i}.${rng() < 0.5 ? 'ts' : 'm3u8'}`;
    }
    if (rng() < 0.05) name = `${name}, Extra`; // commas in names
    const id = `ch${i}.example.test`;
    const chno = rng() < 0.3 ? ` tvg-chno="${i}"` : '';
    yield `#EXTINF:-1 tvg-id="${id}" tvg-name="${name.replaceAll('"', '')}" tvg-logo="http://img.example.test/logos/${i}.png"${chno} group-title="${group}",${name}`;
    yield `http://stream.example.test/${path}`;
  }
}

async function main(argv) {
  const args = [];
  let seed = 42;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') seed = Number(argv[++i]);
    else args.push(argv[i]);
  }
  const count = Number(args[0]);
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(seed)) {
    process.stderr.write('usage: generate-m3u.mjs <count> [out] [--seed N]\n');
    process.exit(2);
  }
  const out = args[1] ? createWriteStream(args[1]) : process.stdout;
  for (const line of generateM3uLines(count, seed)) {
    if (!out.write(line + '\n')) await new Promise((r) => out.once('drain', r));
  }
  if (out !== process.stdout) await new Promise((r) => out.end(r));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main(process.argv.slice(2));
}
