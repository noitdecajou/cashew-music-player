// Generates the app icons (exe, installer, taskbar, tray) from the single glyph
// source: src/renderer/assets/brand/cashew-glyph.svg. Rendered by Chromium,
// assembled into .ico by build/brand/make-ico.py.
//   node build/brand/make-icons.mjs   (then commit build/ and resources/ icons)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(join(root, 'src/renderer/assets/brand/cashew-glyph.svg'), 'utf8');
const path = id => new RegExp(`<path[^>]*id="${id}"[^>]*\\sd="([^"]+)"`).exec(source)[1];
const BODY = path('body'),
  RIDGE = path('ridge');

// The tile of the brand canvas: 96 px, radius 24, 160° gradient, 1 px inner rim,
// glyph 56 px. Small sizes get a bigger glyph (legibility) and no ridge.
function tile(size) {
  const radius = size * 0.25;
  const glyph = size * (size <= 24 ? 0.74 : size < 48 ? 0.66 : 0.58);
  const offset = (size - glyph) / 2;
  const ridge =
    size >= 32 ? `<path d="${RIDGE}" fill="none" stroke="#A86F35" stroke-width="1.1" stroke-linecap="round"/>` : '';
  const rim =
    size >= 24
      ? `<rect x=".5" y=".5" width="${size - 1}" height="${size - 1}" rx="${radius - 0.5}" fill="none" stroke="#3B342B"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><linearGradient id="g" x1="0.33" y1="0" x2="0.67" y2="1"><stop offset="0" stop-color="#2B2620"/><stop offset="1" stop-color="#17140F"/></linearGradient></defs>
<rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>${rim}
<g transform="translate(${offset} ${offset}) scale(${glyph / 24})"><path d="${BODY}" fill="#E3B57A"/>${ridge}</g></svg>`;
}

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];
const out = mkdtempSync(join(tmpdir(), 'cashew-icons-'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${tile(size)}</body></html>`);
  await page.screenshot({ path: join(out, `${size}.png`), omitBackground: true });
}
await browser.close();
execFileSync('python3', ['-I', join(root, 'build/brand/make-ico.py'), out, root], { stdio: 'inherit' });
