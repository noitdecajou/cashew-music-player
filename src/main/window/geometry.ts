import type { Rect } from '../services/preferences';

/** Keeps a rectangle fully inside a work area (size clamped first). */
export function fitInside(bounds: Rect, area: Rect): Rect {
  const width = Math.min(area.width, bounds.width);
  const height = Math.min(area.height, bounds.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
}
