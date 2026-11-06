// Brand glyph, built from the single source file assets/brand/cashew-glyph.svg.
import glyphSource from '../assets/brand/cashew-glyph.svg?raw';

function pathData(id: string): string {
  const match = new RegExp(`<path[^>]*id="${id}"[^>]*\\sd="([^"]+)"`).exec(glyphSource) ?? new RegExp(`<path[^>]*\\sd="([^"]+)"[^>]*id="${id}"`).exec(glyphSource);
  if (!match?.[1]) throw new Error(`cashew-glyph.svg: path "${id}" not found`);
  return match[1];
}
export const GLYPH_BODY = pathData('body');
export const GLYPH_RIDGE = pathData('ridge');

/**
 * Adds the glyph variants to the page's SVG sprite, used as
 * <svg><use href="#i-cashew…"/></svg>. They take the text color (currentColor):
 * - #i-cashew          filled
 * - #i-cashew-outline  outline
 * - #i-cashew-ridge    filled with its ridge (32 px and up)
 */
export function installGlyphSymbols(sprite: Element): void {
  const ns = 'http://www.w3.org/2000/svg';
  const symbol = (id: string, ...paths: Record<string, string>[]): void => {
    const element = document.createElementNS(ns, 'symbol');
    element.id = id;
    element.setAttribute('viewBox', '0 0 24 24');
    for (const attributes of paths) {
      const path = document.createElementNS(ns, 'path');
      for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
      element.append(path);
    }
    sprite.append(element);
  };
  symbol('i-cashew', { d: GLYPH_BODY, fill: 'currentColor' });
  symbol('i-cashew-outline', { d: GLYPH_BODY, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round' });
  symbol('i-cashew-ridge', { d: GLYPH_BODY, fill: 'currentColor' },
    { d: GLYPH_RIDGE, fill: 'none', stroke: 'var(--cashew-700, #A86F35)', 'stroke-width': '1.1', 'stroke-linecap': 'round' });
}

/** The glyph centred on a square tile, as an image (empty cover art). */
export function glyphTile(glyph: string, background: string, size = 96): string {
  const inset = size * 0.25, scale = (size - 2 * inset) / 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${background}"/>`
    + `<path transform="translate(${inset} ${inset}) scale(${scale})" d="${GLYPH_BODY}" fill="${glyph}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
