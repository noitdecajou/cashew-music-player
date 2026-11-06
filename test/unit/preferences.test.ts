import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  PreferenceStore,
  migrateLegacy,
  sanitizePreferences,
} from '../../src/main/services/preferences';
import { miniContentSize, normalizeTheme } from '../../src/shared/themes';
import { fitInside } from '../../src/main/window/geometry';

describe('preferences', () => {
  it('migrates the 1.x window-preferences.json', () => {
    const migrated = migrateLegacy({
      miniTheme: 'retro',
      miniSeamless: true,
      shortcut: 'Ctrl+Alt+P',
      mini: true,
      pinned: true,
      quietStartup: false,
      largeBounds: { x: 10, y: 20, width: 1200, height: 800 },
      miniBounds: { x: 1500, y: 900, width: 420, height: 158 },
      maximized: false,
    });
    expect(migrated).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'autoradio',
      seamless: true,
      shortcut: 'Ctrl+Alt+P',
      mini: true,
      pinned: true,
      quietStartup: false,
      largeBounds: { x: 10, y: 20, width: 1200, height: 800 },
      miniPosition: { x: 1500, y: 900 },
    });
  });

  it('falls back to defaults on garbage', () => {
    expect(
      sanitizePreferences({ theme: 'neon', largeBounds: { x: 0, y: 0, width: 5, height: 5 }, mini: 'yes' }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it('prefers the 2.x file, reads 1.x otherwise, and writes atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-prefs-'));
    writeFileSync(join(dir, 'window-preferences.json'), JSON.stringify({ miniTheme: 'hifi-hf' }));
    const store = new PreferenceStore(dir);
    expect(store.value.theme).toBe('hifi-hf');
    store.update({ theme: 'modern' });
    store.flush();
    expect(JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8')).theme).toBe('modern');
    expect(new PreferenceStore(dir).value.theme).toBe('modern');
  });
});

describe('geometry and themes', () => {
  it('keeps a window inside its work area', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(fitInside({ x: 1800, y: 1000, width: 420, height: 158 }, area)).toEqual({
      x: 1500,
      y: 882,
      width: 420,
      height: 158,
    });
    expect(
      fitInside({ x: -3000, y: -50, width: 420, height: 158 }, { x: -1920, y: 0, width: 1920, height: 1080 }),
    ).toEqual({ x: -1920, y: 0, width: 420, height: 158 });
  });
  it('knows every theme size and the panel height', () => {
    expect(miniContentSize('modern', false)).toEqual({ width: 420, height: 128 });
    expect(miniContentSize('autoradio-hf', true)).toEqual({ width: 720, height: 450 });
    expect(normalizeTheme('retro')).toBe('autoradio');
    expect(normalizeTheme(undefined)).toBe('modern');
  });
});
