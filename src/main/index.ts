import { join } from 'node:path';
import { type IpcMainEvent, type IpcMainInvokeEvent, Menu, app, ipcMain, net, powerMonitor } from 'electron';
import type { UiState, WindowAction } from '../shared/ipc';
import { EMPTY_SNAPSHOT, type PlayerSnapshot, sanitizeCommand } from '../shared/player';
import { isMiniTheme } from '../shared/themes';
import { PreferenceStore } from './services/preferences';
import { createTray } from './tray';
import { MainWindow } from './window/main-window';
import { YtmView } from './ytm/ytm-view';

const APP_ID = 'local.musicplayer.desktop'; // same as 1.x: keeps taskbar pins

// Tests only: isolated profile and headless-friendly switches.
if (!app.isPackaged && process.env.MP_USER_DATA) app.setPath('userData', process.env.MP_USER_DATA);

const WINDOW_ACTIONS: readonly WindowAction[] = [
  'toggle-mini', 'pin', 'toggle-title-bar', 'minimize', 'maximize', 'close',
  'toggle-search', 'toggle-queue', 'toggle-settings', 'close-panel', 'reload-music',
];

function main(): void {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  let quitting = false;

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.development`);
    Menu.setApplicationMenu(null);

    const prefs = new PreferenceStore(app.getPath('userData'));
    const ytm = new YtmView(host => send('ui:notice', `Navigation bloquée : ${host}`));
    const window = new MainWindow(prefs, ytm);
    const shell = window.win.webContents;
    let snapshot: PlayerSnapshot = EMPTY_SNAPSHOT;

    function send(channel: string, value: unknown): void {
      if (!shell.isDestroyed()) shell.send(channel, value);
    }
    const fromShell = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      event.sender === shell && event.senderFrame === shell.mainFrame;

    // The page streams its clock only while someone can see it.
    let streaming: boolean | null = null;
    const updateStreaming = (): void => {
      const wanted = window.visible;
      if (wanted === streaming) return;
      streaming = wanted;
      ytm.send({ type: 'progress-stream', enabled: wanted });
    };

    ytm.subscribe(message => {
      if (message.kind === 'ready') { streaming = null; updateStreaming(); return; }
      if (message.kind === 'snapshot') { snapshot = message.snapshot; send('player:snapshot', snapshot); return; }
      if (window.visible) send('player:progress', message.progress);
    });

    window.onState((state: UiState) => { send('ui:state', state); updateStreaming(); });
    window.win.on('show', updateStreaming);
    window.win.on('hide', updateStreaming);
    window.win.on('minimize', updateStreaming);
    window.win.on('restore', updateStreaming);

    ipcMain.on('shell:command', (event, raw) => {
      if (!fromShell(event)) return;
      const command = sanitizeCommand(raw);
      if (command) ytm.send(command);
    });
    ipcMain.on('shell:window', (event, action) => {
      if (fromShell(event) && WINDOW_ACTIONS.includes(action)) window.action(action);
    });
    ipcMain.on('shell:drag', (event, phase) => {
      if (fromShell(event) && ['start', 'move', 'end', 'cancel'].includes(phase)) window.dragPhase(phase);
    });
    ipcMain.on('shell:nudge', (event, dx, dy) => {
      if (fromShell(event) && typeof dx === 'number' && typeof dy === 'number') window.nudge(dx, dy);
    });
    ipcMain.handle('shell:set-theme', (event, theme) => {
      if (!fromShell(event) || !isMiniTheme(theme)) throw new Error('Apparence invalide');
      window.setTheme(theme);
      return window.state;
    });

    shell.on('did-finish-load', () => {
      send('ui:state', window.state);
      send('player:snapshot', snapshot);
    });

    const online = (): void => window.setOnline(net.isOnline());
    powerMonitor.on('resume', online);
    online();

    const tray = createTray({
      open: () => window.show(),
      togglePlay: () => ytm.send({ type: 'toggle-play' }),
      quit: () => app.quit(),
    });

    window.win.on('close', event => {
      window.saveBounds();
      if (quitting || tray.isDestroyed()) return;
      event.preventDefault();
      window.win.hide();
    });
    app.on('second-instance', () => window.show());
    app.on('before-quit', () => { quitting = true; window.saveBounds(); prefs.flush(); });
    app.on('will-quit', () => { tray.destroy(); ytm.dispose(); });

    window.win.once('ready-to-show', () => {
      const quiet = process.argv.includes('--startup') && prefs.value.quietStartup;
      if (!quiet) window.show();
    });

    if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void window.win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else void window.win.loadFile(join(__dirname, '../renderer/index.html'));
    ytm.load();
  });

  app.on('window-all-closed', () => app.quit());
}

main();
