import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { ISLAND_WINDOW, type IslandPosition, islandBounds, orderDisplays } from '../../shared/island';
import { guardPage } from './main-window';

export type PageLoader = (contents: Electron.WebContents) => void;

/** The pill's place in the window (DIP, window coordinates), reported by the page. */
export interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The island: a transparent, always-on-top window hanging from the top edge of
 * a display. It never takes the focus and lets clicks through, except while the
 * pointer is over the pill. Main watches the cursor itself: on Windows, the
 * page's mouse events are unreliable while clicks go through the window.
 */
export class IslandWindow {
  private win: BrowserWindow | null = null;
  private visible = false;
  private position: IslandPosition = 'center';
  private display = 0;
  private scale = 1;
  private pill: PillRect | null = null;
  private hovering = false;
  private cursorInside = false;
  private cursorTimer: NodeJS.Timeout | null = null;
  private protectedFromCapture = true;

  constructor(
    private readonly load: PageLoader,
    private readonly onCreated: (contents: Electron.WebContents) => void,
    private readonly onVisibility: () => void,
    private readonly onHover: (hover: boolean) => void = () => {},
  ) {
    const replace = (): void => this.place();
    screen.on('display-added', replace);
    screen.on('display-removed', replace);
    screen.on('display-metrics-changed', replace);
  }

  get contents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Number of displays, for the settings (primary first). */
  static displayNames(): string[] {
    const ordered = orderDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
    return ordered.map(
      (d, i) => `${i === 0 ? 'Écran principal' : `Écran ${i + 1}`} (${d.size.width} × ${d.size.height})`,
    );
  }

  apply(visible: boolean, position: IslandPosition, display: number, scale = 1): void {
    this.position = position;
    this.display = display;
    this.scale = scale;
    if (visible) {
      const win = this.ensure();
      this.place();
      if (!win.isVisible()) win.showInactive();
      // Fullscreen games may raise themselves above "always on top": claim it again.
      win.setAlwaysOnTop(true, 'screen-saver');
    } else if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.setHover(false);
      this.win.hide();
    }
    if (visible !== this.visible) {
      this.visible = visible;
      this.watchCursor(visible);
      this.onVisibility();
    }
  }

  /** The page reports where the pill is (it grows on hover). */
  setPill(rect: PillRect): void {
    this.pill = rect;
  }

  /** Hidden from screenshots and screen sharing (Windows 10 2004 and later). */
  setCaptureProtection(protect: boolean): void {
    this.protectedFromCapture = protect;
    if (this.win && !this.win.isDestroyed()) this.win.setContentProtection(protect);
  }

  private watchCursor(active: boolean): void {
    if (active && !this.cursorTimer) this.cursorTimer = setInterval(() => this.checkCursor(), 60);
    else if (!active && this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
      this.cursorInside = false;
    }
  }

  /** Enter/leave the pill, from the real cursor position (changes only). */
  private checkCursor(): void {
    if (!this.win || this.win.isDestroyed() || !this.pill) return;
    const cursor = screen.getCursorScreenPoint();
    const b = this.win.getBounds();
    const margin = 4;
    const p = this.pill;
    const inside =
      cursor.x >= b.x + p.x - margin &&
      cursor.x <= b.x + p.x + p.width + margin &&
      cursor.y >= b.y + p.y - margin &&
      cursor.y <= b.y + p.y + p.height + margin;
    if (inside === this.cursorInside) return;
    this.cursorInside = inside;
    this.setHover(inside);
  }

  /** Creates the (hidden) window ahead of time: the first appearance is then instant. */
  preload(): void {
    this.ensure();
  }

  /** Back above the other "always on top" windows (on Windows they share one level). */
  raise(): void {
    if (!this.visible || !this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop();
  }

  /** The pointer entered or left the pill (cursor watch, or the page's own mouse events). */
  setHover(hover: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (hover === this.hovering) return;
    this.hovering = hover;
    this.win.setIgnoreMouseEvents(!hover, { forward: true });
    this.onHover(hover);
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      ...ISLAND_WINDOW,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'cashew island',
      webPreferences: {
        preload: join(__dirname, '../preload/shell.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentProtection(this.protectedFromCapture);
    this.hovering = false;
    guardPage(win.webContents);
    win.on('closed', () => {
      this.win = null;
    });
    this.win = win;
    this.onCreated(win.webContents);
    this.load(win.webContents);
    return win;
  }

  private place(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const displays = orderDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
    const display = displays[this.display] ?? displays[0];
    if (display) this.win.setBounds(islandBounds(display.bounds, this.position, this.scale));
  }

  dispose(): void {
    this.watchCursor(false);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
