import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISLAND,
  type IslandPrefs,
  decideIsland,
  exeName,
  islandBounds,
  lineAt,
  orderDisplays,
  parseLrc,
  sanitizeIsland,
  sanitizeLyrics,
} from '../../src/shared/island';

const prefs = (patch: Partial<IslandPrefs>): IslandPrefs => ({ ...DEFAULT_ISLAND, ...patch });
const game = { exe: 'game.exe', title: 'Game', fullscreen: true };

describe('island preferences', () => {
  it('defaults: off, centered, lyrics on, automatic fullscreen detection', () => {
    expect(sanitizeIsland(undefined)).toEqual(DEFAULT_ISLAND);
    expect(DEFAULT_ISLAND.mode).toBe('off');
  });

  it('keeps valid values and drops the rest', () => {
    const p = sanitizeIsland({
      mode: 'games',
      position: 'right',
      display: 2,
      clock: 'left',
      lyrics: false,
      autoFullscreen: false,
      games: [
        { exe: 'C:\\Games\\Foo\\Foo.EXE', name: ' Foo ', enabled: false, position: 'left' },
        { exe: 'foo.exe', name: 'duplicate' },
        { exe: 'notes.txt' },
        { exe: '../evil.exe', position: 'top' },
      ],
    });
    expect(p).toMatchObject({ mode: 'games', position: 'right', display: 2, clock: 'left', lyrics: false });
    expect(p.games).toEqual([
      { exe: 'foo.exe', name: 'Foo', enabled: false, position: 'left' },
      { exe: 'evil.exe', name: 'evil.exe', enabled: true, position: 'center' },
    ]);
    expect(sanitizeIsland({ mode: 'sometimes', position: 'top', display: -1, clock: 'up' })).toMatchObject({
      mode: 'off',
      position: 'center',
      display: 0,
      clock: 'none',
    });
  });

  it('caps the game list', () => {
    const games = Array.from({ length: 150 }, (_, i) => ({ exe: `g${i}.exe` }));
    expect(sanitizeIsland({ games }).games).toHaveLength(100);
  });

  it('extracts executable names only', () => {
    expect(exeName('C:\\Program Files\\Riot\\VALORANT.exe')).toBe('valorant.exe');
    expect(exeName('/usr/bin/game.exe')).toBe('game.exe');
    expect(exeName('game')).toBe('');
    expect(exeName(42)).toBe('');
  });
});

describe('when the island shows', () => {
  it('never without a track, never when off', () => {
    expect(decideIsland(prefs({ mode: 'always' }), null, false).visible).toBe(false);
    expect(decideIsland(prefs({ mode: 'off' }), game, true).visible).toBe(false);
  });

  it('always: everywhere, at the chosen position', () => {
    expect(decideIsland(prefs({ mode: 'always', position: 'left' }), null, true)).toEqual({
      visible: true,
      position: 'left',
    });
  });

  it('games: a listed game decides (enabled, position)', () => {
    const p = prefs({
      mode: 'games',
      games: [
        { exe: 'game.exe', name: 'Game', enabled: true, position: 'right' },
        { exe: 'quiet.exe', name: 'Quiet', enabled: false, position: 'center' },
      ],
    });
    expect(decideIsland(p, { ...game, fullscreen: false }, true)).toEqual({ visible: true, position: 'right' });
    expect(decideIsland(p, { exe: 'quiet.exe', title: '', fullscreen: true }, true).visible).toBe(false);
  });

  it('games: any fullscreen application when automatic detection is on', () => {
    const other = { exe: 'other.exe', title: '', fullscreen: true };
    expect(decideIsland(prefs({ mode: 'games' }), other, true)).toEqual({ visible: true, position: 'center' });
    expect(decideIsland(prefs({ mode: 'games', autoFullscreen: false }), other, true).visible).toBe(false);
    expect(decideIsland(prefs({ mode: 'games' }), { ...other, fullscreen: false }, true).visible).toBe(false);
    expect(decideIsland(prefs({ mode: 'games' }), null, true).visible).toBe(false);
  });
});

describe('island geometry', () => {
  const display = { x: 1920, y: 0, width: 2560, height: 1440 };
  it('hangs from the top edge, left, centered or right', () => {
    expect(islandBounds(display, 'center')).toEqual({ x: 1920 + 1050, y: 0, width: 460, height: 150 });
    expect(islandBounds(display, 'left').x).toBe(1936);
    expect(islandBounds(display, 'right').x).toBe(1920 + 2560 - 460 - 16);
  });
  it('orders displays: primary, then left to right', () => {
    const d = (id: number, x: number) => ({ id, bounds: { x, y: 0, width: 100, height: 100 } });
    expect(orderDisplays([d(1, -1920), d(2, 0), d(3, 1920)], 2).map(x => x.id)).toEqual([2, 1, 3]);
  });
});

describe('synced lyrics', () => {
  const lrc = '[ar: Someone]\n[00:12.50] Second line\n[00:05.00][01:05.00] Chorus\n[00:20] Third\nno stamp';
  it('parses LRC, several stamps per line, sorted', () => {
    expect(parseLrc(lrc)).toEqual([
      { time: 5, text: 'Chorus' },
      { time: 12.5, text: 'Second line' },
      { time: 20, text: 'Third' },
      { time: 65, text: 'Chorus' },
    ]);
    expect(parseLrc(undefined)).toEqual([]);
  });
  it('finds the line being sung', () => {
    const lines = parseLrc(lrc);
    expect(lineAt(lines, 0)).toBe(-1);
    expect(lineAt(lines, 5)).toBe(0);
    expect(lineAt(lines, 19.9)).toBe(1);
    expect(lineAt(lines, 300)).toBe(3);
  });
  it('validates lyrics sent to the island page', () => {
    expect(
      sanitizeLyrics({
        trackId: 'x',
        status: 'synced',
        lines: [
          { time: 1, text: 'a' },
          { time: -1, text: 'b' },
        ],
      }),
    ).toEqual({ trackId: 'x', status: 'synced', lines: [{ time: 1, text: 'a' }] });
    expect(sanitizeLyrics({ trackId: 'x', status: 'stolen', lines: [] })).toBeNull();
  });
});
