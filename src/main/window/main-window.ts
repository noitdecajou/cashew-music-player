import { join } from 'node:path';
import { BrowserWindow, WebContentsView, screen, shell } from 'electron';
import type { Panel, UiState, WindowAction } from '../../shared/ipc';
import { LARGE_TOOLBAR_HEIGHT, type MiniTheme, TITLE_BAR_HEIGHT, miniContentSize } from '../../shared/themes';
import type { PreferenceStore, Rect } from '../services/preferences';
import type { YtmView } from '../ytm/ytm-view';
import { fitInside } from './geometry';

const LARGE_MIN = { width: 800, height: 600 };
const LARGE_DEFAULT = { width: 1180, height: 820 };
/** Width of the side panel (search, queue, settings) in large mode. */
const SIDE_PANEL_WIDTH = 380;
const ICON = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

/**
 * One frameless window. The shell (our UI) fills it; the YouTube Music view is
 * a native child view placed under the toolbar in large mode and detached in
 * mini mode (its page keeps playing).
 */
export class MainWindow {
  readonly win: BrowserWindow;
  private ui: UiState;
  private attached = false;
  private applying = false;
  private wasMini = false;
  private drag: { cursor: Electron.Point; window: Electron.Point } | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(state: UiState) => void>();

  /** Panels (search, queue, settings) live in their own native view so they can
   *  overlap the YouTube Music view instead of resizing it. Created on first use. */
  private drawer: WebContentsView | null = null;
  private drawerAttached = false;

  constructor(
    private readonly prefs: PreferenceStore,
    private readonly ytm: YtmView,
    private readonly loadRenderer: (contents: Electron.WebContents, view?: 'drawer') => void,
    private readonly onDrawerCreated: (contents: Electron.WebContents) => void,
  ) {
    const p = prefs.value;
    this.ui = {
      mini: p.mini,
      theme: p.theme,
      panel: 'none',
      pinned: p.pinned,
      seamless: p.seamless,
      maximized: false,
      online: true,
      videoFullscreen: false,
      musicLoading: true,
    };
    this.win = new BrowserWindow({
      ...LARGE_DEFAULT,
      show: false,
      frame: false,
      backgroundColor: '#111218',
      icon: ICON,
      minWidth: 1,
      minHeight: 1,
      webPreferences: {
        preload: join(__dirname, '../preload/shell.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    if (p.pinned) this.win.setAlwaysOnTop(true, 'normal');
    guardPage(this.win.webContents);
    this.applyMode(true);

    this.win.on('resize', () => {
      this.layout();
      this.scheduleSave();
    });
    this.win.on('move', () => this.scheduleSave());
    this.win.on('maximize', () => this.setUi({ maximized: true }));
    this.win.on('unmaximize', () => this.setUi({ maximized: false }));
    this.win.on('blur', () => {
      this.drag = null;
    });
    screen.on('display-removed', this.refit);
    screen.on('display-metrics-changed', this.refit);
    const contents = this.ytm.view.webContents;
    // Splash while YouTube Music really loads (full page loads only, no fixed delay).
    contents.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isSameDocument) this.setMusicLoading(true);
    });
    contents.on('did-finish-load', () => this.setMusicLoading(false));
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.setMusicLoading(false);
    });
    contents.on('enter-html-full-screen', () => this.setVideoFullscreen(true));
    contents.on('leave-html-full-screen', () => this.setVideoFullscreen(false));
    this.win.on('leave-full-screen', () => {
      if (this.ui.videoFullscreen)
        void contents.executeJavaScript('document.exitFullscreen?.().catch(() => {})').catch(() => undefined);
    });
    // Large mode: the drawer is an overlay; going back to YouTube Music closes it.
    // Only a real click in YouTube Music closes the overlay. Focus changes are not
    // reliable for this: on Windows the view can take focus while the drawer is
    // being attached, which closed the drawer as soon as it opened.
    this.ytm.view.webContents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown' && !this.ui.mini && this.ui.panel !== 'none') this.setPanel('none');
    });
    this.win.on('closed', () => {
      if (this.drawer && !this.drawer.webContents.isDestroyed()) this.drawer.webContents.close();
      screen.removeListener('display-removed', this.refit);
      screen.removeListener('display-metrics-changed', this.refit);
    });
  }

  get state(): UiState {
    return this.ui;
  }
  get visible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized();
  }

  onState(listener: (state: UiState) => void): void {
    this.listeners.add(listener);
  }

  private setUi(patch: Partial<UiState>): void {
    this.ui = { ...this.ui, ...patch };
    for (const listener of this.listeners) listener(this.ui);
  }

  private titleBarHeight(): number {
    return this.ui.mini && this.ui.seamless ? 0 : TITLE_BAR_HEIGHT;
  }

  private workAreaFor(bounds: Rect): Rect {
    return screen.getDisplayMatching(bounds).workArea;
  }

  /** Sizes and places the window for the current mode. */
  private applyMode(initial = false): void {
    if (this.applying) return;
    this.applying = true;
    try {
      const p = this.prefs.value;
      if (this.ui.mini) {
        if (this.win.isMaximized()) this.win.unmaximize();
        this.win.setResizable(false);
        this.win.setMaximizable(false);
        const size = miniContentSize(this.ui.theme, this.ui.panel !== 'none');
        const current = this.win.getBounds();
        const anchor = initial || !this.wasMini ? (p.miniPosition ?? current) : current;
        const wanted = { x: anchor.x, y: anchor.y, width: size.width, height: size.height + this.titleBarHeight() };
        const fitted = fitInside(wanted, this.workAreaFor(wanted));
        this.win.setMinimumSize(1, 1);
        this.win.setBounds(fitted);
      } else {
        this.win.setResizable(true);
        this.win.setMaximizable(true);
        this.win.setMinimumSize(LARGE_MIN.width, LARGE_MIN.height);
        const saved = p.largeBounds ?? { ...this.win.getBounds(), ...LARGE_DEFAULT };
        this.win.setBounds(
          fitInside(
            {
              ...saved,
              width: Math.max(saved.width, LARGE_MIN.width),
              height: Math.max(saved.height, LARGE_MIN.height),
            },
            this.workAreaFor(saved),
          ),
        );
        if (p.maximized) this.win.maximize();
      }
      this.wasMini = this.ui.mini;
    } finally {
      this.applying = false;
    }
    this.layout();
  }
  private readonly refit = (): void => {
    if (this.ui.mini) this.applyMode();
  };

  get drawerContents(): Electron.WebContents | null {
    return this.drawer && !this.drawer.webContents.isDestroyed() ? this.drawer.webContents : null;
  }

  private ensureDrawer(): WebContentsView {
    if (this.drawer) return this.drawer;
    this.drawer = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/shell.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.drawer.setBackgroundColor('#1a1c24');
    guardPage(this.drawer.webContents);
    this.onDrawerCreated(this.drawer.webContents);
    this.loadRenderer(this.drawer.webContents, 'drawer');
    return this.drawer;
  }

  private restoreFullScreen = false;

  /** YouTube Music's own fullscreen video: the view covers the whole screen. */
  setVideoFullscreen(active: boolean): void {
    if (active === this.ui.videoFullscreen || this.win.isDestroyed()) return;
    if (active) {
      if (this.ui.mini) {
        // The mini-player has no room for video: refuse it (Electron already made the
        // window fullscreen for the page).
        void this.ytm.view.webContents
          .executeJavaScript('document.exitFullscreen?.().catch(() => {})')
          .catch(() => undefined);
        if (this.win.isFullScreen()) this.win.setFullScreen(false);
        return;
      }
      this.restoreFullScreen = this.win.isFullScreen();
      this.setUi({ videoFullscreen: true, panel: 'none' });
      if (!this.restoreFullScreen) this.win.setFullScreen(true);
    } else {
      this.setUi({ videoFullscreen: false });
      if (!this.restoreFullScreen && this.win.isFullScreen()) this.win.setFullScreen(false);
    }
    this.layout();
  }

  private setMusicLoading(loading: boolean): void {
    if (loading === this.ui.musicLoading) return;
    this.setUi({ musicLoading: loading });
    this.layout();
  }

  /** Places (or detaches) the YouTube Music view and the drawer above it. */
  layout(): void {
    if (this.win.isDestroyed()) return;
    const view = this.ytm.view;
    const [width = 0, height = 0] = this.win.getContentSize();
    if (this.ui.videoFullscreen && !this.ui.mini) {
      if (!this.attached) {
        this.win.contentView.addChildView(view);
        this.attached = true;
      }
      view.setBounds({ x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) });
      if (this.drawer && this.drawerAttached) {
        this.win.contentView.removeChildView(this.drawer);
        this.drawerAttached = false;
      }
      return;
    }
    if (this.ui.mini || this.ui.musicLoading) {
      // Mini: the page keeps playing detached. Loading: the shell shows the splash.
      if (this.attached) {
        this.win.contentView.removeChildView(view);
        this.attached = false;
      }
    } else {
      if (!this.attached) {
        this.win.contentView.addChildView(view);
        this.attached = true;
        // Keep the drawer on top of the YouTube Music view.
        if (this.drawer && this.drawerAttached) this.win.contentView.addChildView(this.drawer);
      }
      const top = TITLE_BAR_HEIGHT + LARGE_TOOLBAR_HEIGHT;
      view.setBounds({ x: 0, y: top, width: Math.max(1, width), height: Math.max(1, height - top) });
    }

    if (this.ui.panel === 'none') {
      if (this.drawer && this.drawerAttached) {
        this.win.contentView.removeChildView(this.drawer);
        this.drawerAttached = false;
      }
      return;
    }
    const drawer = this.ensureDrawer();
    if (!this.drawerAttached) {
      this.win.contentView.addChildView(drawer);
      this.drawerAttached = true;
    }
    if (this.ui.mini) {
      const top = this.titleBarHeight() + miniContentSize(this.ui.theme, false).height;
      drawer.setBounds({ x: 0, y: top, width: Math.max(1, width), height: Math.max(1, height - top) });
    } else {
      const top = TITLE_BAR_HEIGHT + LARGE_TOOLBAR_HEIGHT;
      drawer.setBounds({
        x: Math.max(0, width - SIDE_PANEL_WIDTH),
        y: top,
        width: Math.min(width, SIDE_PANEL_WIDTH),
        height: Math.max(1, height - top),
      });
    }
  }

  private scheduleSave(): void {
    if (this.applying || this.win.isDestroyed()) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBounds(), 200);
  }

  saveBounds(): void {
    if (this.win.isDestroyed() || this.applying) return;
    const bounds = this.win.getNormalBounds();
    if (this.ui.mini) this.prefs.update({ miniPosition: { x: bounds.x, y: bounds.y } });
    else this.prefs.update({ largeBounds: bounds, maximized: this.win.isMaximized() });
  }

  setMini(mini: boolean): void {
    if (mini === this.ui.mini) return;
    if (this.ui.videoFullscreen) {
      void this.ytm.view.webContents
        .executeJavaScript('document.exitFullscreen?.().catch(() => {})')
        .catch(() => undefined);
      this.setVideoFullscreen(false);
    }
    this.drag = null;
    this.saveBounds();
    this.setUi({ mini, panel: 'none' });
    this.prefs.update({ mini });
    this.applyMode();
  }

  setPanel(panel: Panel): void {
    if (panel === this.ui.panel || (panel !== 'none' && this.ui.videoFullscreen)) return;
    this.drag = null;
    this.setUi({ panel });
    if (this.ui.mini) this.applyMode();
    else this.layout();
    if (panel !== 'none') this.drawerContents?.focus();
    else if (!this.win.isDestroyed()) this.win.webContents.focus();
  }

  /** Created ahead of time so the first panel opens instantly. */
  preloadDrawer(): void {
    this.ensureDrawer();
  }

  setSeamless(seamless: boolean): void {
    if (seamless === this.ui.seamless) return;
    this.prefs.update({ seamless });
    this.setUi({ seamless });
    if (this.ui.mini) this.applyMode();
  }

  toggleVisibility(): void {
    if (this.visible && this.win.isFocused()) {
      this.win.hide();
      return;
    }
    this.setMini(true);
    this.show();
  }

  setTheme(theme: MiniTheme): void {
    this.setUi({ theme });
    this.prefs.update({ theme });
    if (this.ui.mini) this.applyMode();
  }

  setOnline(online: boolean): void {
    if (online !== this.ui.online) this.setUi({ online });
  }

  show(): void {
    if (this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    if (this.ui.mini) this.applyMode();
    this.win.show();
    this.win.focus();
  }

  action(action: WindowAction): void {
    switch (action) {
      case 'toggle-mini':
        this.setMini(!this.ui.mini);
        break;
      case 'pin': {
        const pinned = !this.ui.pinned;
        this.win.setAlwaysOnTop(pinned, 'normal');
        this.prefs.update({ pinned });
        this.setUi({ pinned });
        break;
      }
      case 'toggle-title-bar':
        if (this.ui.mini) this.setSeamless(!this.ui.seamless);
        break;
      case 'minimize':
        this.win.minimize();
        break;
      case 'maximize':
        if (!this.ui.mini) {
          if (this.win.isMaximized()) this.win.unmaximize();
          else this.win.maximize();
        }
        break;
      case 'close':
        this.win.close();
        break;
      case 'toggle-search':
        this.setPanel(this.ui.panel === 'search' ? 'none' : 'search');
        break;
      case 'toggle-queue':
        this.setPanel(this.ui.panel === 'queue' ? 'none' : 'queue');
        break;
      case 'toggle-settings':
        this.setPanel(this.ui.panel === 'settings' ? 'none' : 'settings');
        break;
      case 'close-panel':
        this.setPanel('none');
        break;
      case 'reload-music':
        this.ytm.reload();
        break;
      case 'repair-display':
        break; // handled by the app (reloads our pages)
    }
  }

  /** Pointer-driven move of the mini window (works without a title bar). */
  dragPhase(phase: 'start' | 'move' | 'end' | 'cancel'): void {
    if (!this.ui.mini || this.win.isDestroyed()) return;
    if (phase === 'start') {
      const [x = 0, y = 0] = this.win.getPosition();
      this.drag = { cursor: screen.getCursorScreenPoint(), window: { x, y } };
      return;
    }
    if (!this.drag) return;
    if (phase === 'cancel') {
      this.drag = null;
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const x = this.drag.window.x + cursor.x - this.drag.cursor.x;
    const y = this.drag.window.y + cursor.y - this.drag.cursor.y;
    const bounds = this.win.getBounds();
    if (phase === 'move') {
      this.win.setBounds({ ...bounds, x, y });
      return;
    }
    this.drag = null;
    const target = { ...bounds, x, y };
    this.win.setBounds(fitInside(target, this.workAreaFor(target)));
    this.saveBounds();
  }

  nudge(dx: number, dy: number): void {
    if (!this.ui.mini || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const b = this.win.getBounds();
    const target = { ...b, x: b.x + Math.max(-50, Math.min(50, dx)), y: b.y + Math.max(-50, Math.min(50, dy)) };
    this.win.setBounds(fitInside(target, this.workAreaFor(target)));
    this.saveBounds();
  }
}

/** Our pages never navigate away nor open windows: GitHub links open in the browser. */
function guardPage(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/noitdecajou\/cashew-music-player(\/|$)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', event => event.preventDefault());
}
