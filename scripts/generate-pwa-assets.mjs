// Generates the PWA icons and placeholder screenshots in public/ (PWA-01). Dependency-free: shapes
// are rasterized with 4×4 supersampling and written as PNG with node:zlib. Colours come from the
// design tokens (src/ui/theme/tokens.ts; Node ≥ 22.18 strips the TypeScript types on import).
// The icon geometry mirrors public/icons/icon.svg (favicon); keep both in sync.
// Usage: node scripts/generate-pwa-assets.mjs   (then commit the PNGs)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { colors } from '../src/ui/theme/tokens.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { dark } = colors;

// --- PNG encoding -------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA pixels (Uint8Array, width*height*4) → PNG bytes. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Shapes (predicates in scene coordinates) ---------------------------------------------------

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

function roundRect(x, y, w, h, r) {
  return (px, py) => {
    const dx = Math.max(x + r - px, 0, px - (x + w - r));
    const dy = Math.max(y + r - py, 0, py - (y + h - r));
    return px >= x && px <= x + w && py >= y && py <= y + h && dx * dx + dy * dy <= r * r;
  };
}

function strokeRoundRect(x, y, w, h, r, width) {
  const half = width / 2;
  const outer = roundRect(x - half, y - half, w + width, h + width, r + half);
  const inner = roundRect(x + half, y + half, w - width, h - width, Math.max(r - half, 0));
  return (px, py) => outer(px, py) && !inner(px, py);
}

function capsule(x1, y1, x2, y2, width) {
  const r2 = (width / 2) ** 2;
  return (px, py) => {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const t = Math.min(1, Math.max(0, ((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy)));
    return (px - x1 - t * vx) ** 2 + (py - y1 - t * vy) ** 2 <= r2;
  };
}

function triangle([ax, ay], [bx, by], [cx, cy]) {
  const side = (px, py, x1, y1, x2, y2) => (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
  return (px, py) => {
    const s1 = side(px, py, ax, ay, bx, by);
    const s2 = side(px, py, bx, by, cx, cy);
    const s3 = side(px, py, cx, cy, ax, ay);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
}

/**
 * Rasterizes layers ({ test, color }) painted in order over a transparent canvas. `scale` maps
 * pixel → scene units; 4×4 supersampling gives anti-aliased edges.
 */
function render(width, height, scale, layers) {
  const rgba = new Uint8Array(width * height * 4);
  const S = 4;
  const parsed = layers.map((layer) => ({ test: layer.test, rgb: hex(layer.color) }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) * scale;
          const py = (y + (sy + 0.5) / S) * scale;
          let hit;
          for (const layer of parsed) if (layer.test(px, py)) hit = layer.rgb;
          if (hit) {
            r += hit[0];
            g += hit[1];
            b += hit[2];
            a += 1;
          }
        }
      }
      const i = (y * width + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((255 * a) / (S * S));
      }
    }
  }
  return encodePng(width, height, rgba);
}

// --- Icon (512-unit scene, same geometry as public/icons/icon.svg) -------------------------------

/** The TV-with-play-button mark, scaled by `k` around the centre of the 512 scene. */
function mark(k, dy = 0) {
  const t = (v) => 256 + (v - 256) * k;
  const ty = (v) => 256 + (v + dy - 256) * k;
  return [
    { test: strokeRoundRect(t(96), ty(128), 320 * k, 216 * k, 36 * k, 28 * k), color: dark.accent },
    { test: capsule(t(200), ty(400), t(312), ty(400), 28 * k), color: dark.accent },
    { test: triangle([t(228), ty(190)], [t(228), ty(282)], [t(304), ty(236)]), color: dark.accent },
  ];
}

function icon(size, { maskable }) {
  const background = maskable
    ? { test: () => true, color: dark.bg } // full bleed: the platform applies its own mask
    : { test: roundRect(0, 0, 512, 512, 112), color: dark.bg };
  // Maskable: the mark sits inside the 80 % safe-zone circle (radius 205 of 512).
  const layers = [background, ...(maskable ? mark(0.72, -8) : mark(1))];
  return render(size, size, 512 / size, layers);
}

// --- Placeholder screenshots (generic app layout, no third-party content) ------------------------

function screenshot(width, height, { wide }) {
  const layers = [{ test: () => true, color: dark.bg }];
  const bar = wide ? 64 : 56;
  layers.push({ test: (x, y) => y < bar, color: dark.surface2 });
  layers.push({ test: roundRect(16, bar / 2 - 12, 24, 24, 6), color: dark.accent });
  let left = 16;
  if (wide) {
    layers.push({ test: (x, y) => y >= bar && x < 88, color: dark.surface1 });
    for (let i = 0; i < 5; i++) {
      layers.push({
        test: roundRect(28, bar + 24 + i * 72, 32, 32, 8),
        color: i === 0 ? dark.accent : dark.surface3,
      });
    }
    left = 88 + 32;
  } else {
    layers.push({ test: (x, y) => y >= height - 64, color: dark.surface2 });
    for (let i = 0; i < 4; i++) {
      const cx = (width / 4) * (i + 0.5);
      layers.push({
        test: roundRect(cx - 14, height - 46, 28, 28, 8),
        color: i === 0 ? dark.accent : dark.surface3,
      });
    }
  }
  const cols = wide ? 5 : 2;
  const gap = 16;
  const right = 16;
  const cardW = (width - left - right - gap * (cols - 1)) / cols;
  const cardH = cardW * 0.6;
  const rows = Math.floor((height - bar - (wide ? 32 : 96)) / (cardH + gap + 32));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = left + c * (cardW + gap);
      const y = bar + 24 + r * (cardH + gap + 32);
      layers.push({ test: roundRect(x, y, cardW, cardH, 12), color: dark.surface1 });
      layers.push({ test: roundRect(x, y + cardH + 8, cardW * 0.7, 10, 5), color: dark.surface3 });
      if ((r + c) % 3 === 0) {
        layers.push({ test: roundRect(x + 8, y + 8, 28, 12, 6), color: dark.live });
      }
    }
  }
  return render(width, height, 1, layers);
}

const outputs = [
  ['public/icons/icon-192.png', () => icon(192, { maskable: false })],
  ['public/icons/icon-512.png', () => icon(512, { maskable: false })],
  ['public/icons/icon-maskable-192.png', () => icon(192, { maskable: true })],
  ['public/icons/icon-maskable-512.png', () => icon(512, { maskable: true })],
  ['public/icons/apple-touch-icon.png', () => icon(180, { maskable: true })],
  ['public/screenshots/narrow.png', () => screenshot(540, 960, { wide: false })],
  ['public/screenshots/wide.png', () => screenshot(1280, 720, { wide: true })],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [file, make] of outputs) {
    const path = join(ROOT, file);
    mkdirSync(dirname(path), { recursive: true });
    const png = make();
    writeFileSync(path, png);
    process.stdout.write(`${file}: ${png.length} bytes\n`);
  }
}
