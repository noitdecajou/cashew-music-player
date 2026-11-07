import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { ISLAND_WINDOW, type IslandPosition, islandBounds, orderDisplays } from '../../shared/island';
import { guardPage } from './main-window';

export type PageLoader = (contents: Electron.WebContents) => void;

/**
 * The island: a transparent, always-on-top window hanging from the top edge of
 * a display. It never takes the focus and lets clicks through, except while the
 * pointer is over the pill (the page reports it, then the window takes clicks).
 */
export class IslandWindow {
  private win: BrowserWindow | null = null;
  private visible = false;
  private position: IslandPosition = 'center';
  private display = 0;
  private scale = 1;

  constructor(
    private readonly load: PageLoader,
    private readonly onCreated: (contents: Electron.WebContents) => void,
    private readonly onVisibility: () => void,
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
      this.onVisibility();
    }
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

  /** The pointer entered or left the pill. */
  setHover(hover: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!hover, { forward: true });
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
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
