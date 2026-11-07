import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { log } from '../services/log';
import { ICON, guardPage } from './main-window';
import type { PageLoader } from './island-window';

export type { SettingsSection } from '../../shared/ipc';
import type { SettingsSection } from '../../shared/ipc';

/** The settings: their own window, with sections in a sidebar on the left. */
export class SettingsWindow {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly load: PageLoader,
    private readonly onCreated: (contents: Electron.WebContents) => void,
    /** The player is pinned on top: the settings must come above it. */
    private readonly playerOnTop: () => boolean,
  ) {}

  get contents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  open(section?: SettingsSection): void {
    try {
      this.openWindow(section);
    } catch (error) {
      log('settings: cannot open', error);
      throw error;
    }
  }

  private bringToFront(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    win.setAlwaysOnTop(this.playerOnTop(), 'normal');
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();
  }

  private openWindow(section?: SettingsSection): void {
    if (this.win && !this.win.isDestroyed()) {
      this.bringToFront(this.win);
      if (section) this.win.webContents.send('settings:section', section);
      return;
    }
    log(`settings: opening${section ? ` (${section})` : ''}`);
    const win = new BrowserWindow({
      width: 820,
      height: 600,
      minWidth: 680,
      minHeight: 460,
      // Shown right below (dark background until the page paints): never waits for an event.
      show: false,
      title: 'Réglages — cashew',
      icon: ICON,
      backgroundColor: '#111218',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#111218', symbolColor: '#a1a5b6', height: 36 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/shell.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    guardPage(win.webContents);
    win.on('closed', () => {
      this.win = null;
    });
    this.win = win;
    this.onCreated(win.webContents);
    if (section) win.webContents.once('did-finish-load', () => win.webContents.send('settings:section', section));
    this.load(win.webContents);
    win.center();
    this.bringToFront(win);
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }
}
