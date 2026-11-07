// The island: a small always-on-top pill at the top of a screen showing the
// current track (lyrics when known). Pure rules and types, shared by main and
// the island page, and unit-tested.

export type IslandMode = 'off' | 'always' | 'games';
export type IslandPosition = 'left' | 'center' | 'right';
export type ClockSide = 'none' | 'left' | 'right';

export interface GameRule {
  /** Executable file name, lowercase (e.g. "valorant-win64-shipping.exe"). */
  exe: string;
  /** Display name (window title or file name). */
  name: string;
  enabled: boolean;
  position: IslandPosition;
}

export interface IslandPrefs {
  mode: IslandMode;
  position: IslandPosition;
  /** 0 = primary display, then the other displays from left to right. */
  display: number;
  clock: ClockSide;
  /** Synced lyrics from LRCLIB (sends title and artist to lrclib.net). */
  lyrics: boolean;
  /** In "games" mode, also show the island over any application recognized as a game (`isGame`). */
  autoFullscreen: boolean;
  games: GameRule[];
}

export const DEFAULT_ISLAND: IslandPrefs = {
  mode: 'off',
  position: 'center',
  display: 0,
  clock: 'none',
  lyrics: true,
  autoFullscreen: true,
  games: [],
};

export const MAX_GAMES = 100;
const POSITIONS: readonly IslandPosition[] = ['left', 'center', 'right'];
const EXE = /^[^\\/:*?"<>|]{1,120}\.exe$/;

export const isPosition = (value: unknown): value is IslandPosition => POSITIONS.includes(value as IslandPosition);

/** "C:\\Games\\Foo\\Foo.exe" -> "foo.exe"; '' when not an executable name. */
export function exeName(path: unknown): string {
  if (typeof path !== 'string') return '';
  const name = path.split(/[\\/]/).pop()?.trim().toLowerCase() ?? '';
  return EXE.test(name) ? name : '';
}

function gameRule(raw: unknown): GameRule | null {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const exe = exeName(v.exe);
  if (!exe) return null;
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : exe;
  return {
    exe,
    name,
    enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
    position: isPosition(v.position) ? v.position : 'center',
  };
}

export function sanitizeIsland(raw: unknown): IslandPrefs {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const games: GameRule[] = [];
  for (const item of Array.isArray(v.games) ? v.games : []) {
    const rule = gameRule(item);
    if (rule && !games.some(g => g.exe === rule.exe)) games.push(rule);
    if (games.length >= MAX_GAMES) break;
  }
  return {
    mode: v.mode === 'always' || v.mode === 'games' ? v.mode : 'off',
    position: isPosition(v.position) ? v.position : DEFAULT_ISLAND.position,
    display:
      Number.isInteger(v.display) && (v.display as number) >= 0 && (v.display as number) < 16
        ? (v.display as number)
        : 0,
    clock: v.clock === 'left' || v.clock === 'right' ? v.clock : 'none',
    lyrics: typeof v.lyrics === 'boolean' ? v.lyrics : DEFAULT_ISLAND.lyrics,
    autoFullscreen: typeof v.autoFullscreen === 'boolean' ? v.autoFullscreen : DEFAULT_ISLAND.autoFullscreen,
    games,
  };
}

/** What is in front of the user (Windows only; null elsewhere or when unknown). */
export interface Foreground {
  exe: string;
  title: string;
  fullscreen: boolean;
  /** Recognized as a game (install folder of a game store, or known to Windows as a game). */
  game: boolean;
}

/** Never games, even fullscreen: browsers, media players, Windows shell and overlays. */
const NOT_GAMES = new Set([
  'explorer.exe',
  'firefox.exe',
  'chrome.exe',
  'msedge.exe',
  'opera.exe',
  'opera_gx.exe',
  'brave.exe',
  'vivaldi.exe',
  'iexplore.exe',
  'arc.exe',
  'zen.exe',
  'librewolf.exe',
  'waterfox.exe',
  'vlc.exe',
  'mpv.exe',
  'mpc-hc64.exe',
  'mpc-be64.exe',
  'potplayermini64.exe',
  'wmplayer.exe',
  'applicationframehost.exe',
  'searchhost.exe',
  'searchapp.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'lockapp.exe',
  'gamebar.exe',
  'steam.exe',
  'steamwebhelper.exe',
  'epicgameslauncher.exe',
  'galaxyclient.exe',
  'discord.exe',
  'music player.exe',
]);

/** Install folders of game stores and launchers (lowercase, Windows separators). */
const GAME_FOLDERS = [
  '\\steamapps\\common\\',
  '\\epic games\\',
  '\\gog galaxy\\games\\',
  '\\gog games\\',
  '\\ubisoft game launcher\\games\\',
  '\\ea games\\',
  '\\origin games\\',
  '\\riot games\\',
  '\\xboxgames\\',
  '\\amazon games\\library\\',
  '\\rockstar games\\',
  '\\battle.net\\games\\',
  '\\itch\\apps\\',
  '\\heroic\\games\\',
  '\\games\\heroic\\',
];

/**
 * Whether an application in front is a game: installed in a game store folder,
 * or known to Windows as a game (Game Bar), and never a browser or shell window.
 * Fullscreen alone is not enough (maximized browsers, videos, Alt+Tab).
 */
export const notAGame = (exe: string): boolean => !exe || NOT_GAMES.has(exe);

export function isGame(path: string, exe: string, windowsGames: ReadonlySet<string>): boolean {
  if (notAGame(exe)) return false;
  const p = path.toLowerCase().replace(/\//g, '\\');
  if (GAME_FOLDERS.some(folder => p.includes(folder))) return true;
  return windowsGames.has(p) || windowsGames.has(exe);
}

export interface IslandDecision {
  visible: boolean;
  position: IslandPosition;
}

/**
 * Whether the island shows, and where. In "games" mode a listed game decides
 * on its own (enabled, position); an unlisted application recognized as a game
 * shows the island when automatic detection is on.
 */
export function decideIsland(prefs: IslandPrefs, foreground: Foreground | null, hasTrack: boolean): IslandDecision {
  const hidden = { visible: false, position: prefs.position };
  if (!hasTrack || prefs.mode === 'off') return hidden;
  if (prefs.mode === 'always') return { visible: true, position: prefs.position };
  if (!foreground) return hidden;
  const rule = prefs.games.find(g => g.exe === foreground.exe);
  if (rule) return { visible: rule.enabled, position: rule.position };
  if (prefs.autoFullscreen && foreground.game) return { visible: true, position: prefs.position };
  return hidden;
}

// ------------------------------------------------------------------ geometry --

export const ISLAND_WINDOW = { width: 460, height: 150 } as const;
const EDGE_MARGIN = 16;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The island window hangs from the top edge of the display (not its work area). */
export function islandBounds(display: Box, position: IslandPosition): Box {
  const { width, height } = ISLAND_WINDOW;
  const x =
    position === 'left'
      ? display.x + EDGE_MARGIN
      : position === 'right'
        ? display.x + display.width - width - EDGE_MARGIN
        : display.x + Math.round((display.width - width) / 2);
  return { x, y: display.y, width, height };
}

/** Primary display first, then the others from left to right, then top to bottom. */
export function orderDisplays<T extends { id: number; bounds: Box }>(displays: T[], primaryId: number): T[] {
  return [...displays].sort((a, b) =>
    a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y,
  );
}

// -------------------------------------------------------------------- lyrics --

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsState {
  trackId: string;
  status: 'off' | 'loading' | 'synced' | 'none';
  lines: LyricLine[];
}

export const MAX_LYRIC_LINES = 400;

/** Parses LRC ("[01:23.45] text", several stamps per line allowed); sorted by time. */
export function parseLrc(text: unknown): LyricLine[] {
  if (typeof text !== 'string') return [];
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const content = raw
      .replace(/\[[^\]]*\]/g, '')
      .trim()
      .slice(0, 200);
    for (const s of stamps) {
      const fraction = s[3] ? Number(`0.${s[3]}`) : 0;
      lines.push({ time: Number(s[1]) * 60 + Number(s[2]) + fraction, text: content });
    }
    if (lines.length >= MAX_LYRIC_LINES) break;
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, MAX_LYRIC_LINES);
}

/** Index of the line sung at `position` (-1 before the first line). */
export function lineAt(lines: readonly LyricLine[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid]?.time ?? Infinity) <= position) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** Validates lyrics before they reach the island page. */
export function sanitizeLyrics(raw: unknown): LyricsState | null {
  const v = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!v || typeof v.trackId !== 'string' || v.trackId.length > 64) return null;
  if (!['off', 'loading', 'synced', 'none'].includes(v.status as string)) return null;
  const lines: LyricLine[] = [];
  for (const line of Array.isArray(v.lines) ? v.lines.slice(0, MAX_LYRIC_LINES) : []) {
    const l = line as Record<string, unknown>;
    if (typeof l?.time === 'number' && Number.isFinite(l.time) && l.time >= 0 && typeof l.text === 'string')
      lines.push({ time: l.time, text: l.text.slice(0, 200) });
  }
  return { trackId: v.trackId, status: v.status as LyricsState['status'], lines };
}

/** Configuration the island page needs (everything else comes from the player events). */
export interface IslandView {
  position: IslandPosition;
  clock: ClockSide;
}
