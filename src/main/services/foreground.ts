// What application is in front of the user, and is it fullscreen? Used by the
// island's "games" mode. Windows only: a few read-only user32/kernel32 calls
// through koffi (no injection into other processes, no hooks: safe with
// anti-cheat software). Elsewhere, and if anything fails, it reports nothing.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { type Foreground, exeName, isGame, notAGame } from '../../shared/island';

/** What the system reports about the window in front, before deciding if it is a game. */
export interface RawForeground {
  exe: string;
  path: string;
  title: string;
  fullscreen: boolean;
}
/** 'own': one of cashew's windows is in front (mini-player, settings): what was detected before stays. */
export type ForegroundReader = () => RawForeground | 'own' | null;

/** The foreground window covers its whole monitor (within a few pixels). */
export function coversMonitor(
  window: { left: number; top: number; right: number; bottom: number },
  monitor: { left: number; top: number; right: number; bottom: number },
): boolean {
  const t = EDGE_TOLERANCE;
  return (
    window.left <= monitor.left + t &&
    window.top <= monitor.top + t &&
    window.right >= monitor.right - t &&
    window.bottom >= monitor.bottom - t
  );
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** Borderless games may stop a few pixels short of the monitor edges. */
const EDGE_TOLERANCE = 4;
const MONITOR_DEFAULTTONEAREST = 2;
/** Shell windows: the desktop is "fullscreen" too but never a game. */
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  // Alt+Tab, Win+Tab and other shell overlays
  'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame',
  'TaskSwitcherWnd',
  'ForegroundStaging',
  'Windows.UI.Core.CoreWindow',
]);

/** Reads the foreground window on Windows; null when unavailable. */
export function windowsForeground(
  log: (...parts: unknown[]) => void,
  onError: (message: string) => void = () => {},
): ForegroundReader | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi') as typeof import('koffi');
    const RECT = koffi.struct('CASHEW_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const MONITORINFO = koffi.struct('CASHEW_MONITORINFO', {
      cbSize: 'uint32',
      rcMonitor: RECT,
      rcWork: RECT,
      dwFlags: 'uint32',
    });
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
    const GetWindowThreadProcessId = user32.func(
      'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)',
    );
    const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ CASHEW_RECT *lpRect)');
    const MonitorFromWindow = user32.func('void * __stdcall MonitorFromWindow(void *hwnd, uint32 dwFlags)');
    const GetMonitorInfoW = user32.func(
      'int __stdcall GetMonitorInfoW(void *hMonitor, _Inout_ CASHEW_MONITORINFO *lpmi)',
    );
    const GetClassNameW = user32.func(
      'int __stdcall GetClassNameW(void *hWnd, _Out_ uint16 *lpClassName, int nMaxCount)',
    );
    const GetWindowTextW = user32.func(
      'int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16 *lpString, int nMaxCount)',
    );
    const OpenProcess = kernel32.func(
      'void * __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)',
    );
    const QueryFullProcessImageNameW = kernel32.func(
      'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ uint16 *lpExeName, _Inout_ uint32 *lpdwSize)',
    );
    const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *hObject)');

    const wide = (read: (buffer: Uint16Array, size: number) => number, size = 260): string => {
      const buffer = new Uint16Array(size);
      const length = read(buffer, size);
      return length > 0 ? String.fromCharCode(...buffer.subarray(0, Math.min(length, size))) : '';
    };
    const own = process.pid;
    let failures = 0;
    /** Executable path per process id (process ids are reused late: a small cache is fine). */
    const paths = new Map<number, string>();
    log('foreground: ready');

    return () => {
      try {
        const hwnd = GetForegroundWindow();
        if (!hwnd) return null;
        if (SHELL_CLASSES.has(wide((b, n) => GetClassNameW(hwnd, b, n), 128))) return null;
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (pid[0] === own) return 'own';
        // The executable's path is asked once per process (minimal "query limited
        // information" right, as Task Manager does): games are not touched again
        // while they stay in front.
        let path = paths.get(pid[0] ?? 0);
        if (path === undefined) {
          path = '';
          const handle = pid[0] ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]) : null;
          if (handle) {
            try {
              const size = [1024];
              const buffer = new Uint16Array(1024);
              if (QueryFullProcessImageNameW(handle, 0, buffer, size))
                path = String.fromCharCode(...buffer.subarray(0, size[0]));
            } finally {
              CloseHandle(handle);
            }
          }
          if (paths.size > 200) paths.clear();
          paths.set(pid[0] ?? 0, path);
        }
        const exe = exeName(path);
        const rect = { left: 0, top: 0, right: 0, bottom: 0 };
        const info = {
          cbSize: koffi.sizeof(MONITORINFO),
          rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
          rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
          dwFlags: 0,
        };
        let fullscreen = false;
        if (GetWindowRect(hwnd, rect) && GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info))
          fullscreen = coversMonitor(rect, info.rcMonitor);
        failures = 0;
        const title = wide((b, n) => GetWindowTextW(hwnd, b, n), 200).slice(0, 80);
        return exe || title ? { exe, path, title, fullscreen } : null;
      } catch (error) {
        // Keep trying (the next window may be fine); log the first failures only.
        if (failures++ < 3) log('foreground: read failed', error);
        onError(error instanceof Error ? error.message : String(error));
        return null;
      }
    };
  } catch (error) {
    log('foreground: unavailable', error);
    onError(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Windows presentation mode (SHQueryUserNotificationState): the user said
 * "I am presenting"; the island stays out of the way. null outside Windows.
 */
export function windowsPresentationMode(log: (...parts: unknown[]) => void): (() => boolean) | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi') as typeof import('koffi');
    const shell32 = koffi.load('shell32.dll');
    const query = shell32.func('int32 __stdcall SHQueryUserNotificationState(_Out_ int32 *pquns)');
    const QUNS_PRESENTATION_MODE = 4;
    return () => {
      try {
        const state = [0];
        return query(state) === 0 && state[0] === QUNS_PRESENTATION_MODE;
      } catch {
        return false;
      }
    };
  } catch (error) {
    log('presentation mode: unavailable', error);
    return null;
  }
}

/** Test-only: the foreground is read from a JSON file ({path, title, fullscreen}). */
export function fileForeground(path: string): ForegroundReader {
  return () => {
    try {
      const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      if (v.own === true) return 'own';
      const full = String(v.path ?? v.exe ?? '');
      const exe = exeName(full);
      return exe
        ? { exe, path: full, title: String(v.title ?? '').slice(0, 80), fullscreen: v.fullscreen === true }
        : null;
    } catch {
      return null;
    }
  };
}

/**
 * Games Windows knows (Xbox Game Bar keeps one registry key per detected game,
 * with the executable's full path). Lowercase full paths and file names; empty
 * when unavailable.
 */
export function windowsGameList(log: (...parts: unknown[]) => void): Promise<Set<string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Set());
  return new Promise(resolve => {
    execFile(
      'reg.exe',
      ['query', 'HKCU\\System\\GameConfigStore\\Children', '/s', '/v', 'MatchedExeFullPath'],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const games = new Set<string>();
        for (const match of String(stdout ?? '').matchAll(/MatchedExeFullPath\s+REG_\w+\s+(.+?)\s*$/gim)) {
          const full = (match[1] ?? '').toLowerCase().replace(/\//g, '\\');
          const exe = exeName(full);
          if (exe) {
            games.add(full);
            games.add(exe);
          }
        }
        if (error && !games.size) log('foreground: Windows game list unavailable', error.message);
        resolve(games);
      },
    );
  });
}

/** Polls the foreground while needed and reports changes. */
export class ForegroundWatcher {
  private timer: NodeJS.Timeout | null = null;
  private last: Foreground | null = null;
  /** Polls in a row without a readable window (Alt+Tab, desktop, our own windows). */
  private gaps = 0;
  private windowsGames: Set<string> = new Set();
  private gamesLoadedAt = 0;
  /** Applications seen recently that may be games, newest first: offered in the game list. */
  readonly recent: Foreground[] = [];
  /** Last application seen in front (diagnostics in the settings). */
  lastSeen: Foreground | null = null;

  constructor(
    private readonly read: ForegroundReader | null,
    private readonly onChange: (foreground: Foreground | null) => void,
    private readonly loadGames: () => Promise<Set<string>> = async () => new Set(),
    private readonly intervalMs = 1000,
  ) {}

  get supported(): boolean {
    return !!this.read;
  }

  get current(): Foreground | null {
    return this.last;
  }

  /** Number of games Windows knows (diagnostics). */
  get knownGames(): number {
    return [...this.windowsGames].filter(g => g.includes('\\')).length;
  }

  /** Reads the list of games Windows knows ahead of time (it takes a moment). */
  prepare(): void {
    if (this.read) this.refreshGames();
  }

  setActive(active: boolean): void {
    if (!this.read) return;
    if (active && !this.timer) {
      this.refreshGames();
      this.tick();
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.last) {
        this.last = null;
        this.onChange(null);
      }
    }
  }

  private refreshGames(): void {
    if (Date.now() - this.gamesLoadedAt < 10 * 60_000) return;
    this.gamesLoadedAt = Date.now();
    void this.loadGames().then(games => {
      this.windowsGames = games;
    });
  }

  private tick(): void {
    this.refreshGames();
    const read = this.read?.() ?? null;
    if (read === 'own') return;
    const raw = read;
    // Alt+Tab or a glance at the desktop: keep the previous state for a moment.
    if (!raw && this.last && this.gaps++ < 2) return;
    this.gaps = 0;
    const now: Foreground | null = raw
      ? {
          exe: raw.exe,
          title: raw.title,
          fullscreen: raw.fullscreen,
          game: isGame(raw.path, raw.exe, this.windowsGames),
        }
      : null;
    if (now) this.lastSeen = now;
    if (now && (now.game || (now.fullscreen && !notAGame(now.exe)))) {
      const index = this.recent.findIndex(r => r.exe === now.exe);
      if (index >= 0) this.recent.splice(index, 1);
      this.recent.unshift(now);
      this.recent.length = Math.min(this.recent.length, 10);
    }
    const same =
      now?.exe === this.last?.exe &&
      now?.fullscreen === this.last?.fullscreen &&
      now?.game === this.last?.game &&
      now?.title === this.last?.title;
    if (same) return;
    this.last = now;
    this.onChange(now);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
