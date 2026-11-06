import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type MiniTheme, normalizeTheme } from '../../shared/themes';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Preferences {
  version: 2;
  mini: boolean;
  theme: MiniTheme;
  seamless: boolean;
  pinned: boolean;
  maximized: boolean;
  largeBounds: Rect | null;
  /** Mini window position only: its size always comes from the theme. */
  miniPosition: { x: number; y: number } | null;
  shortcut: string;
  quietStartup: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 2,
  mini: false,
  theme: 'modern',
  seamless: false,
  pinned: false,
  maximized: false,
  largeBounds: null,
  miniPosition: null,
  shortcut: 'Ctrl+Alt+M',
  quietStartup: true,
};

const FILE = 'preferences.json';
const LEGACY_FILE = 'window-preferences.json';

function rect(value: unknown): Rect | null {
  const v = value as Record<string, unknown> | null;
  if (!v || !['x', 'y', 'width', 'height'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))) return null;
  const r = {
    x: Math.round(v.x as number),
    y: Math.round(v.y as number),
    width: Math.round(v.width as number),
    height: Math.round(v.height as number),
  };
  return r.width >= 200 && r.height >= 100 && r.width <= 20000 && r.height <= 20000 ? r : null;
}

export function sanitizePreferences(raw: unknown): Preferences {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  for (const key of ['mini', 'seamless', 'pinned', 'maximized', 'quietStartup'] as const) {
    if (typeof v[key] === 'boolean') result[key] = v[key] as boolean;
  }
  result.theme = normalizeTheme(v.theme);
  result.largeBounds = rect(v.largeBounds);
  const p = v.miniPosition as Record<string, unknown> | null | undefined;
  result.miniPosition =
    p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: Math.round(p.x as number), y: Math.round(p.y as number) }
      : null;
  if (typeof v.shortcut === 'string' && v.shortcut.length <= 80) result.shortcut = v.shortcut;
  return result;
}

/** 1.x stored window-preferences.json with different keys. */
export function migrateLegacy(raw: unknown): Preferences {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mini = rect(v.miniBounds);
  return sanitizePreferences({
    mini: v.mini,
    theme: v.miniTheme,
    seamless: v.miniSeamless,
    pinned: v.pinned,
    maximized: v.maximized,
    largeBounds: v.largeBounds,
    miniPosition: mini ? { x: mini.x, y: mini.y } : null,
    shortcut: v.shortcut,
    quietStartup: v.quietStartup,
  });
}

export class PreferenceStore {
  private timer: NodeJS.Timeout | null = null;
  value: Preferences;

  constructor(private readonly directory: string) {
    this.value = this.load();
  }

  private load(): Preferences {
    try {
      return sanitizePreferences(JSON.parse(readFileSync(join(this.directory, FILE), 'utf8')));
    } catch {
      /* first run of 2.x */
    }
    try {
      return migrateLegacy(JSON.parse(readFileSync(join(this.directory, LEGACY_FILE), 'utf8')));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  update(patch: Partial<Preferences>): void {
    this.value = sanitizePreferences({ ...this.value, ...patch });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  /** Synchronous and atomic: called on quit, file is tiny. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(this.directory, { recursive: true });
      const file = join(this.directory, FILE);
      writeFileSync(`${file}.tmp`, JSON.stringify(this.value, null, 2));
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.error('preferences: write failed', error);
    }
  }
}
