// Synthetic catalogues for the search tests (SCH-01). Invented names only: no real list data.
import { categoryKey, itemKey, normalizeName, type CatalogItem } from '@/core/db';

const WORDS = [
  'news',
  'sport',
  'cinema',
  'kids',
  'music',
  'documentary',
  'drama',
  'comedy',
  'action',
  'nature',
  'history',
  'science',
  'travel',
  'cooking',
  'football',
  'tennis',
  'racing',
  'weather',
  'family',
  'classic',
  'premium',
  'world',
  'local',
  'nation',
  'ocean',
  'mountain',
  'river',
  'forest',
  'planet',
  'galaxy',
  'shadow',
  'silver',
  'golden',
  'crimson',
  'emerald',
  'midnight',
  'summer',
  'winter',
  'autumn',
  'spring',
  'harbor',
  'castle',
  'garden',
  'bridge',
  'station',
  'island',
  'desert',
  'valley',
  'canyon',
  'thunder',
  'whisper',
  'journey',
  'legend',
  'secret',
  'mystery',
  'empire',
  'kingdom',
  'voyage',
  'horizon',
  'frontier',
  'paradise',
  'velocity',
  'açúcar',
  'coração',
  'são',
  'ribeira',
  'pássaro',
  'música',
  'notícias',
  'história',
];
const PREFIXES = ['PT', 'UK', 'US', 'FR', 'ES', 'DE', 'BR', 'IT'];
const SYLLABLES = [
  'ka',
  'lo',
  'mi',
  'ra',
  'ven',
  'tor',
  'sil',
  'qua',
  'zen',
  'dor',
  'pha',
  'lux',
  'mor',
  'tai',
  'bel',
];

/** Deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `total` items split 30 % live / 50 % movies / 20 % series, with names made of 2–4 words (plus
 * a country prefix and a quality suffix for channels) and 50 categories per type.
 */
export function syntheticCatalog(sourceId: string, total: number, seed = 1): CatalogItem[] {
  const rnd = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] as T;
  const items: CatalogItem[] = [];
  for (let i = 0; i < total; i++) {
    const words = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(WORDS));
    // One invented word per name (2–4 syllables) grows the vocabulary to tens of thousands of
    // distinct terms, like a real list (fuzzy search cost grows with the vocabulary).
    words.splice(
      Math.floor(rnd() * (words.length + 1)),
      0,
      Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => pick(SYLLABLES)).join(''),
    );
    const share = i % 10;
    const externalId = String(i + 1);
    const cat = String(1 + Math.floor(rnd() * 50));
    if (share < 3) {
      const name = `${pick(PREFIXES)} | ${words.join(' ')} ${pick(['HD', 'FHD', '4K', ''])}`.trim();
      items.push({
        key: itemKey(sourceId, 'live', externalId),
        sourceId,
        type: 'live',
        externalId,
        categoryKey: categoryKey(sourceId, 'live', cat),
        name,
        nameNorm: normalizeName(name),
        order: i,
        number: i + 1,
        streamPath: `${externalId}.ts`,
      });
    } else if (share < 8) {
      const name = `${words.join(' ')} (${1950 + Math.floor(rnd() * 75)})`;
      items.push({
        key: itemKey(sourceId, 'movie', externalId),
        sourceId,
        type: 'movie',
        externalId,
        categoryKey: categoryKey(sourceId, 'movie', cat),
        name,
        order: i,
        streamPath: `${externalId}.mp4`,
      });
    } else {
      const name = words.join(' ');
      items.push({
        key: itemKey(sourceId, 'series', externalId),
        sourceId,
        type: 'series',
        externalId,
        categoryKey: categoryKey(sourceId, 'series', cat),
        name,
        order: i,
      });
    }
  }
  return items;
}
