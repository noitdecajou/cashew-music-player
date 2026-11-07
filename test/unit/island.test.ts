import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISLAND,
  type IslandPrefs,
  decideIsland,
  gameToPropose,
  isGame,
  exeName,
  islandBounds,
  lineAt,
  orderDisplays,
  parseLrc,
  sanitizeIsland,
  sanitizeLyrics,
} from '../../src/shared/island';

const prefs = (patch: Partial<IslandPrefs>): IslandPrefs => ({ ...DEFAULT_ISLAND, ...patch });
const game = { exe: 'game.exe', title: 'Game', fullscreen: true, game: true };

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
    expect(decideIsland(p, { exe: 'quiet.exe', title: '', fullscreen: true, game: true }, true).visible).toBe(false);
  });

  it('games: any application recognized as a game when automatic detection is on', () => {
    const other = { exe: 'other.exe', title: '', fullscreen: false, game: true };
    expect(decideIsland(prefs({ mode: 'games' }), other, true)).toEqual({ visible: true, position: 'center' });
    expect(decideIsland(prefs({ mode: 'games', autoFullscreen: false }), other, true).visible).toBe(false);
    const browser = { exe: 'firefox.exe', title: 'Video', fullscreen: true, game: false };
    expect(decideIsland(prefs({ mode: 'games' }), browser, true).visible).toBe(false);
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

describe('fullscreen detection', () => {
  it('a window covering its monitor, within a few pixels, is fullscreen', async () => {
    const { coversMonitor } = await import('../../src/main/services/foreground');
    const monitor = { left: 1920, top: 0, right: 3840, bottom: 1080 };
    expect(coversMonitor(monitor, monitor)).toBe(true);
    expect(coversMonitor({ left: 1921, top: 0, right: 3839, bottom: 1079 }, monitor)).toBe(true); // borderless, 1 px short
    expect(coversMonitor({ left: 1920, top: 0, right: 3840, bottom: 1040 }, monitor)).toBe(false); // maximized, taskbar visible
    expect(coversMonitor({ left: 0, top: 0, right: 1920, bottom: 1080 }, monitor)).toBe(false); // another monitor
  });
});

describe('what counts as a game', () => {
  const none = new Set<string>();
  it('games installed by a store or launcher', () => {
    expect(isGame('D:\\SteamLibrary\\steamapps\\common\\Warframe\\Warframe.x64.exe', 'warframe.x64.exe', none)).toBe(
      true,
    );
    expect(isGame('C:\\Program Files\\Epic Games\\Fortnite\\FortniteClient.exe', 'fortniteclient.exe', none)).toBe(
      true,
    );
    expect(isGame('C:\\XboxGames\\Forza\\Content\\forza.exe', 'forza.exe', none)).toBe(true);
    expect(isGame('C:/Riot Games/VALORANT/live/VALORANT.exe', 'valorant.exe', none)).toBe(true);
  });
  it('games Windows knows (Game Bar), by full path or file name', () => {
    const known = new Set(['c:\\users\\me\\appdata\\local\\warframe\\downloaded\\public\\warframe.x64.exe']);
    expect(
      isGame(
        'C:\\Users\\me\\AppData\\Local\\Warframe\\Downloaded\\Public\\Warframe.x64.exe',
        'warframe.x64.exe',
        known,
      ),
    ).toBe(true);
    expect(isGame('C:\\Tools\\editor.exe', 'editor.exe', known)).toBe(false);
  });
  it('never browsers, Explorer, the Steam client or cashew, even from a game folder', () => {
    expect(isGame('C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'firefox.exe', new Set(['firefox.exe']))).toBe(
      false,
    );
    expect(isGame('C:\\Windows\\explorer.exe', 'explorer.exe', none)).toBe(false);
    expect(isGame('C:\\Program Files (x86)\\Steam\\steam.exe', 'steam.exe', none)).toBe(false);
    expect(isGame('', '', none)).toBe(false);
  });
});

describe('foreground watcher', () => {
  it('classifies, keeps the state through Alt+Tab, lists candidates', async () => {
    const { ForegroundWatcher } = await import('../../src/main/services/foreground');
    let raw: { exe: string; path: string; title: string; fullscreen: boolean } | null = {
      exe: 'warframe.x64.exe',
      path: 'D:\\SteamLibrary\\steamapps\\common\\Warframe\\Warframe.x64.exe',
      title: 'Warframe',
      fullscreen: true,
    };
    const changes: unknown[] = [];
    const watcher = new ForegroundWatcher(
      () => raw,
      f => changes.push(f),
      async () => new Set(),
      60_000,
    );
    watcher.setActive(true);
    expect(watcher.current).toMatchObject({ exe: 'warframe.x64.exe', game: true });
    raw = null; // Alt+Tab
    (watcher as unknown as { tick(): void }).tick();
    (watcher as unknown as { tick(): void }).tick();
    expect(watcher.current?.game).toBe(true);
    raw = { exe: 'firefox.exe', path: 'C:\\Firefox\\firefox.exe', title: 'Video', fullscreen: true };
    (watcher as unknown as { tick(): void }).tick();
    expect(watcher.current).toMatchObject({ exe: 'firefox.exe', game: false });
    expect(watcher.recent.map(r => r.exe)).toEqual(['warframe.x64.exe']);
    watcher.dispose();
    void changes;
  });
});

describe('island v2: modes, questions, size', () => {
  it('track mode: only during a peek; a peek or a question shows the island in any mode but off', () => {
    expect(decideIsland(prefs({ mode: 'track' }), null, true).visible).toBe(false);
    expect(decideIsland(prefs({ mode: 'track' }), null, true, { peek: true, prompt: false }).visible).toBe(true);
    expect(decideIsland(prefs({ mode: 'games' }), null, true, { peek: true, prompt: false }).visible).toBe(true);
    expect(decideIsland(prefs({ mode: 'games' }), null, false, { peek: false, prompt: true }).visible).toBe(true);
    expect(decideIsland(prefs({ mode: 'off' }), null, true, { peek: true, prompt: true }).visible).toBe(false);
  });

  it('offers a game once: not listed, not declined, not postponed', () => {
    const g = { exe: 'alpha.exe', title: 'Alpha', fullscreen: true, game: true };
    expect(gameToPropose(prefs({ mode: 'games' }), g, new Set())).toBe(g);
    expect(gameToPropose(prefs({ mode: 'games', declined: ['alpha.exe'] }), g, new Set())).toBeNull();
    expect(gameToPropose(prefs({ mode: 'games' }), g, new Set(['alpha.exe']))).toBeNull();
    expect(
      gameToPropose(
        prefs({ mode: 'games', games: [{ exe: 'alpha.exe', name: 'A', enabled: false, position: 'left' }] }),
        g,
        new Set(),
      ),
    ).toBeNull();
    expect(gameToPropose(prefs({ mode: 'games' }), { ...g, game: false }, new Set())).toBeNull();
    expect(gameToPropose(prefs({ mode: 'off' }), g, new Set())).toBeNull();
  });

  it('new preferences: declined list, shortcut, size, opacity', () => {
    const p = sanitizeIsland({
      games: [{ exe: 'a.exe' }],
      declined: ['B.EXE', 'b.exe', 'a.exe', 'notes.txt'],
      shortcut: 'Ctrl+Alt+K',
      size: 'xlarge',
      opacity: 20,
    });
    expect(p.declined).toEqual(['b.exe']);
    expect(p).toMatchObject({ shortcut: 'Ctrl+Alt+K', size: 'xlarge', opacity: 50 });
    expect(sanitizeIsland({ size: 'huge', opacity: 'x' })).toMatchObject({
      size: 'normal',
      opacity: 94,
      shortcut: 'Ctrl+Alt+I',
    });
  });

  it('the window grows with the size', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(islandBounds(display, 'center', 1.2)).toEqual({ x: 684, y: 0, width: 552, height: 180 });
  });
});
