// What application is in front of the user, and is it fullscreen? Used by the
// island's "games" mode. Windows only: a few read-only user32/kernel32 calls
// through koffi (no injection into other processes, no hooks: safe with
// anti-cheat software). Elsewhere, and if anything fails, it reports nothing.

import { readFileSync } from 'node:fs';
import { type Foreground, exeName } from '../../shared/island';

export type ForegroundReader = () => Foreground | null;

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const MONITOR_DEFAULTTONEAREST = 2;
/** Shell windows: the desktop is "fullscreen" too but never a game. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

/** Reads the foreground window on Windows; null when unavailable. */
export function windowsForeground(log: (...parts: unknown[]) => void): ForegroundReader | null {
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

    return () => {
      if (failures > 5) return null; // something is wrong with this system: stop trying
      try {
        const hwnd = GetForegroundWindow();
        if (!hwnd) return null;
        if (SHELL_CLASSES.has(wide((b, n) => GetClassNameW(hwnd, b, n), 128))) return null;
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (!pid[0] || pid[0] === own) return null;
        const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]);
        let path = '';
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
        const exe = exeName(path);
        if (!exe) return null;
        const rect = { left: 0, top: 0, right: 0, bottom: 0 };
        const info = {
          cbSize: koffi.sizeof(MONITORINFO),
          rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
          rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
          dwFlags: 0,
        };
        let fullscreen = false;
        if (GetWindowRect(hwnd, rect) && GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info)) {
          const m = info.rcMonitor;
          fullscreen = rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
        }
        failures = 0;
        return { exe, title: wide((b, n) => GetWindowTextW(hwnd, b, n), 200).slice(0, 80), fullscreen };
      } catch (error) {
        failures++;
        log('foreground: read failed', error);
        return null;
      }
    };
  } catch (error) {
    log('foreground: unavailable', error);
    return null;
  }
}

/** Test-only: the foreground is read from a JSON file ({exe, title, fullscreen}). */
export function fileForeground(path: string): ForegroundReader {
  return () => {
    try {
      const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const exe = exeName(v.exe);
      return exe ? { exe, title: String(v.title ?? '').slice(0, 80), fullscreen: v.fullscreen === true } : null;
    } catch {
      return null;
    }
  };
}

/** Polls the foreground while needed and reports changes. */
export class ForegroundWatcher {
  private timer: NodeJS.Timeout | null = null;
  private last: Foreground | null = null;
  /** Fullscreen applications seen recently, newest first: offered in the game list. */
  readonly recent: Foreground[] = [];

  constructor(
    private readonly read: ForegroundReader | null,
    private readonly onChange: (foreground: Foreground | null) => void,
    private readonly intervalMs = 1500,
  ) {}

  get supported(): boolean {
    return !!this.read;
  }

  get current(): Foreground | null {
    return this.last;
  }

  setActive(active: boolean): void {
    if (!this.read) return;
    if (active && !this.timer) {
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

  private tick(): void {
    const now = this.read?.() ?? null;
    if (now?.fullscreen) {
      const index = this.recent.findIndex(r => r.exe === now.exe);
      if (index >= 0) this.recent.splice(index, 1);
      this.recent.unshift(now);
      this.recent.length = Math.min(this.recent.length, 10);
    }
    const same =
      now?.exe === this.last?.exe && now?.fullscreen === this.last?.fullscreen && now?.title === this.last?.title;
    if (same) return;
    this.last = now;
    this.onChange(now);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
