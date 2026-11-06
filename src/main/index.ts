import { join } from 'node:path';
import { type IpcMainEvent, type IpcMainInvokeEvent, Menu, app, shell as electronShell, ipcMain, powerMonitor } from 'electron';
import type { Diagnostics, QueueAction, SearchResponse, SearchScope, Settings, SettingsPatch, UiState, WindowAction } from '../shared/ipc';
import { EMPTY_SNAPSHOT, PLAYLIST_ID, type PlayerSnapshot, VIDEO_ID, sanitizeCommand, str } from '../shared/player';
import { isMiniTheme } from '../shared/themes';
import { pendingWrites } from './services/json-file';
import { Library } from './services/library';
import { PreferenceStore } from './services/preferences';
import { ResumeStore, type SavedSession, resumeState } from './services/resume';
import { GlobalShortcut } from './services/shortcut';
import { Updater, fakeEngine } from './services/updater';
import { setStartup, startupState } from './services/startup';
import { initLog, log } from './services/log';
import { createTray } from './tray';
import { watchPage } from './watchdog';
import { MainWindow } from './window/main-window';
import { YtmView } from './ytm/ytm-view';

const APP_ID = 'local.musicplayer.desktop'; // same as 1.x: keeps taskbar pins

// Tests only: isolated profile.
if (!app.isPackaged && process.env.MP_USER_DATA) app.setPath('userData', process.env.MP_USER_DATA);

const WINDOW_ACTIONS: readonly WindowAction[] = [
  'toggle-mini', 'pin', 'toggle-title-bar', 'minimize', 'maximize', 'close',
  'toggle-search', 'toggle-queue', 'toggle-settings', 'close-panel', 'reload-music', 'repair-display',
];
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

function main(): void {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  let quitting = false;
  let quitReady = false;

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.development`);
    Menu.setApplicationMenu(null);

    const userData = app.getPath('userData');
    const logDirectory = initLog(userData);
    log(`start ${app.getVersion()} electron ${process.versions.electron} ${process.platform} args=${process.argv.slice(1).join(' ')}`);
    process.on('uncaughtException', error => log('main: uncaught exception', error));
    process.on('unhandledRejection', reason => log('main: unhandled rejection', reason));
    app.on('child-process-gone', (_event, details) => log('child process gone', details));
    const prefs = new PreferenceStore(userData);
    const ytm = new YtmView(host => notice(`Navigation bloquée : ${host}`));
    let snapshot: PlayerSnapshot = EMPTY_SNAPSHOT;

    const loadRenderer = (contents: Electron.WebContents, view?: 'drawer'): void => {
      const search = view ? `view=${view}` : '';
      if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void contents.loadURL(process.env.ELECTRON_RENDERER_URL + (search ? `?${search}` : ''));
      else void contents.loadFile(join(__dirname, '../renderer/index.html'), { search });
    };
    const window = new MainWindow(prefs, ytm, loadRenderer, drawer => {
      watchPage('drawer', drawer, () => drawer.send('ui:state', window.state));
      drawer.on('did-finish-load', () => {
        drawer.send('ui:state', window.state);
        drawer.send('player:snapshot', snapshot);
        drawer.send('library:status', library.currentStatus);
        drawer.send('update:state', updater.state);
      });
    });
    const shell = window.win.webContents;

    /** Our own UI: the window shell and the drawer view. */
    const uiContents = (): Electron.WebContents[] =>
      [shell, window.drawerContents].filter((c): c is Electron.WebContents => !!c && !c.isDestroyed());
    function send(channel: string, value: unknown): void {
      for (const contents of uiContents()) contents.send(channel, value);
    }
    function notice(message: string): void { send('ui:notice', message); }
    const fromUi = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      uiContents().some(contents => event.sender === contents && event.senderFrame === contents.mainFrame);
    function handle(channel: string, listener: (...args: unknown[]) => unknown): void {
      ipcMain.handle(channel, (event, ...args) => {
        if (!fromUi(event)) throw new Error('Accès refusé');
        return listener(...args);
      });
    }

    // --- Library ----------------------------------------------------------
    const library = new Library(userData, {
      playlists: continuation => ytm.request('library-playlists', { continuation }),
      songs: (browseId, continuation) => ytm.request('playlist-songs', { browseId, continuation }),
    }, status => send('library:status', status));

    // --- Resume -----------------------------------------------------------
    const resumeStore = new ResumeStore(userData);
    let account = '';
    let saved: SavedSession | null = null;
    let offer: SavedSession | null = null; // shown while nothing is loaded
    let resumeBusy = false;
    let resumeError = '';
    let lastPosition = 0;
    let lastSaveAt = 0;
    const publishResume = (): void => send('resume:state', resumeState(offer, resumeBusy, resumeError));

    async function setAccount(key: string): Promise<void> {
      account = key;
      void library.setAccount(key);
      saved = null; offer = null; resumeError = '';
      if (key) {
        const session = await resumeStore.load(key);
        if (account !== key) return;
        saved = session;
        offer = snapshot.track ? null : session;
      }
      publishResume();
    }

    function rememberTrack(): void {
      const track = snapshot.track;
      if (!account || !track) return;
      if (saved?.videoId !== track.id) lastPosition = 0;
      saved = { videoId: track.id, playlistId: track.playlistId, position: lastPosition, title: track.title, artist: track.artist, artwork: track.artwork, savedAt: Date.now() };
      lastSaveAt = Date.now();
      void resumeStore.save(account, saved);
    }

    // --- Player messages ----------------------------------------------------
    let streaming: boolean | null = null;
    let queueWatching: boolean | null = null;
    const updateStreams = (): void => {
      const visible = window.visible;
      if (visible !== streaming) { streaming = visible; ytm.send({ type: 'progress-stream', enabled: visible }); }
      const queue = visible && window.state.panel === 'queue';
      if (queue !== queueWatching) { queueWatching = queue; ytm.send({ type: 'queue-watch', enabled: queue }); }
    };

    ytm.subscribe(message => {
      switch (message.kind) {
        case 'ready': streaming = null; queueWatching = null; updateStreams(); return;
        case 'queue': send('queue:state', message.queue); return;
        case 'progress':
          if (message.progress.trackId === snapshot.track?.id) {
            lastPosition = message.progress.position;
            if (saved && Date.now() - lastSaveAt > 15000) { saved.position = lastPosition; rememberTrack(); }
          }
          if (window.visible) send('player:progress', message.progress);
          return;
        case 'snapshot': {
          const previous = snapshot;
          snapshot = message.snapshot;
          send('player:snapshot', snapshot);
          if (snapshot.accountKey !== account) void setAccount(snapshot.accountKey);
          if (snapshot.track && offer && !resumeBusy) { offer = null; publishResume(); }
          if (snapshot.track && snapshot.track.id !== previous.track?.id) rememberTrack();
          return;
        }
      }
    });

    window.onState((state: UiState) => { send('ui:state', state); updateStreams(); });
    for (const event of ['show', 'hide', 'minimize', 'restore'] as const) window.win.on(event as 'show', updateStreams);

    // --- IPC: player and window -------------------------------------------
    ipcMain.on('shell:command', (event, raw) => {
      if (!fromUi(event)) return;
      const command = sanitizeCommand(raw);
      if (command) ytm.send(command);
    });
    ipcMain.on('shell:window', (event, action) => {
      if (!fromUi(event) || !WINDOW_ACTIONS.includes(action)) return;
      if (action === 'repair-display') repairDisplay(); else window.action(action);
    });
    ipcMain.on('shell:drag', (event, phase) => {
      if (fromUi(event) && ['start', 'move', 'end', 'cancel'].includes(phase)) window.dragPhase(phase);
    });
    ipcMain.on('shell:nudge', (event, dx, dy) => {
      if (fromUi(event) && typeof dx === 'number' && typeof dy === 'number') window.nudge(dx, dy);
    });
    ipcMain.on('shell:network', (event, online) => {
      if (!fromUi(event) || typeof online !== 'boolean') return;
      const wasOnline = window.state.online;
      window.setOnline(online);
      if (online && !wasOnline) { retryCount = 0; retryLoad(); }
    });
    handle('shell:set-theme', theme => {
      if (!isMiniTheme(theme)) throw new Error('Apparence invalide');
      window.setTheme(theme);
      return window.state;
    });

    handle('player:play', async raw => {
      const target = (raw ?? {}) as Record<string, unknown>;
      const videoId = VIDEO_ID.test(str(target.videoId)) ? str(target.videoId) : undefined;
      let playlistId = PLAYLIST_ID.test(str(target.playlistId)) ? str(target.playlistId) : undefined;
      if (!videoId && !playlistId) throw new Error('Rien à lire.');
      if (playlistId?.startsWith('VL')) playlistId = playlistId.slice(2); // browse id -> playlist id
      offer = null; publishResume();
      await ytm.request('play', { videoId, playlistId });
    });
    handle('player:queue', async raw => {
      const a = (raw ?? {}) as QueueAction & Record<string, unknown>;
      if (!VIDEO_ID.test(str(a.videoId))) throw new Error('Morceau invalide.');
      if (a.action === 'insert-next') { await ytm.request('queue-insert-next', { videoId: a.videoId }); return; }
      if ((a.action !== 'play' && a.action !== 'remove') || !Number.isInteger(a.index) || a.index < 0) throw new Error('Action invalide.');
      await ytm.request(a.action === 'play' ? 'queue-play' : 'queue-remove', { index: a.index, videoId: a.videoId });
    });
    handle('player:resume', async () => {
      if (!offer || resumeBusy) return;
      if (!window.state.online) throw new Error('La reprise sera possible au retour du réseau.');
      resumeBusy = true; resumeError = ''; publishResume();
      try {
        await ytm.request('resume', { videoId: offer.videoId, playlistId: offer.playlistId, position: offer.position }, 30000);
        offer = null;
      } catch (error) {
        resumeError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally { resumeBusy = false; publishResume(); }
    });

    // --- IPC: library -------------------------------------------------------
    handle('library:search', async (query, scope) => {
      if (typeof query !== 'string' || query.length > 200) throw new Error('Recherche invalide');
      const response: SearchResponse = { songs: [], playlists: [], status: library.currentStatus };
      switch (scope as SearchScope) {
        case 'library': response.songs = library.searchSongs(query); break;
        case 'playlists': response.playlists = library.searchPlaylists(query); break;
        case 'web':
          if (query.trim()) response.songs = (await ytm.request('search', { query: query.trim() })).items.map(s => ({ ...s, detail: '' }));
          break;
        default: throw new Error('Recherche invalide');
      }
      return response;
    });
    handle('library:refresh', async () => {
      if (!account) throw new Error('Connecte-toi à YouTube Music pour indexer tes playlists.');
      void library.refresh();
      return library.currentStatus;
    });
    handle('library:favorite', async (id, favorite) => {
      if (!PLAYLIST_ID.test(str(id)) || typeof favorite !== 'boolean') throw new Error('Favori invalide');
      await library.setFavorite(str(id), favorite);
    });

    // --- Settings -------------------------------------------------------------
    const shortcut = new GlobalShortcut(() => window.toggleVisibility());
    let shortcutError = shortcut.set(prefs.value.shortcut);
    const settings = (): Settings => ({
      version: app.getVersion(), startup: startupState(), quietStartup: prefs.value.quietStartup,
      shortcut: shortcut.current || (shortcutError ? prefs.value.shortcut : ''), shortcutError,
    });
    handle('settings:get', () => settings());
    handle('settings:update', raw => {
      const patch = (raw ?? {}) as SettingsPatch;
      if (typeof patch.startup === 'boolean') setStartup(patch.startup);
      if (typeof patch.quietStartup === 'boolean') prefs.update({ quietStartup: patch.quietStartup });
      if (typeof patch.shortcut === 'string') {
        shortcutError = shortcut.set(patch.shortcut);
        if (!shortcutError) prefs.update({ shortcut: shortcut.current });
      }
      return settings();
    });
    ipcMain.on('settings:capture-shortcut', (event, capturing) => {
      if (fromUi(event) && typeof capturing === 'boolean') shortcut.suspend(capturing);
    });
    handle('app:diagnostics', (): Diagnostics => {
      const metrics = app.getAppMetrics();
      return {
        version: app.getVersion(), electron: process.versions.electron,
        memoryMB: Math.round(metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0) / 1024),
        cpu: Math.round(metrics.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0) * 10) / 10,
        processes: metrics.length, userData,
      };
    });

    // --- Updates (GitHub Releases) -------------------------------------------
    let updater: Updater;
    {
      // Real updates only for the installed app; tests may inject a fake.
      const engine = app.isPackaged ? (require('electron-updater') as typeof import('electron-updater')).autoUpdater
        : process.env.MP_FAKE_UPDATER ? fakeEngine() : null;
      updater = new Updater(engine, app.getVersion(), state => {
        send('update:state', state);
        if (state.status === 'available') notice(`Mise à jour ${state.version} disponible : Réglages → Mises à jour.`);
        tray.setUpdate(state);
      }, () => { quitting = true; quitReady = true; window.saveBounds(); prefs.flush(); });
    }
    handle('app:update', async action => {
      if (action === 'check') return updater.check(true);
      if (action === 'download') return updater.download();
      if (action === 'install') { updater.install(); return updater.state; }
      throw new Error('Action invalide');
    });

    // --- Network: retry when YouTube Music cannot load --------------------
    let loadedOnce = false;
    let retryCount = 0;
    let retryTimer: NodeJS.Timeout | null = null;
    const music = ytm.view.webContents;
    function retryLoad(): void {
      if (loadedOnce || retryTimer || !window.state.online || quitting) return;
      const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
      retryTimer = setTimeout(() => { retryTimer = null; retryCount++; ytm.load(); }, delay);
    }
    music.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: aborted by a newer navigation
      notice(window.state.online ? 'YouTube Music est inaccessible. Nouvelle tentative…' : 'Hors ligne : YouTube Music se rechargera au retour du réseau.');
      retryLoad();
    });
    music.on('did-finish-load', () => { if (music.getURL().startsWith('https://music.youtube.com/')) { loadedOnce = true; retryCount = 0; } });
    powerMonitor.on('resume', () => { if (!loadedOnce) { retryCount = 0; retryLoad(); } });

    // --- Tray, lifecycle ------------------------------------------------------
    const tray = createTray({
      open: () => window.show(),
      toggleMini: () => { window.setMini(!window.state.mini); window.show(); },
      command: type => ytm.send({ type }),
      quit: () => app.quit(),
      update: () => { window.setMini(false); window.show(); window.setPanel('settings'); },
      repair: () => repairDisplay(),
      openLogs: () => { void electronShell.openPath(logDirectory); },
    });

    /** Back to a known-good display: large player with its title bar, pages reloaded. */
    function repairDisplay(): void {
      log('repair display requested');
      window.setPanel('none');
      window.setSeamless(false);
      window.setMini(false);
      shell.reloadIgnoringCache();
      window.drawerContents?.reloadIgnoringCache();
      window.show();
    }

    const sendInitialState = (): void => {
      send('ui:state', window.state);
      send('player:snapshot', snapshot);
      send('library:status', library.currentStatus);
      send('update:state', updater.state);
      publishResume();
    };
    shell.on('did-finish-load', sendInitialState);
    watchPage('shell', shell, sendInitialState);

    window.win.on('close', event => {
      window.saveBounds();
      if (quitting || tray.isDestroyed()) return;
      event.preventDefault();
      window.win.hide();
    });
    app.on('second-instance', () => window.show());
    app.on('before-quit', event => {
      if (quitReady) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      window.saveBounds();
      prefs.flush();
      // Remember the exact position for the next start (bounded wait).
      const capture = account && snapshot.track
        ? ytm.request('session', {}, 1500).then(session => {
          if (saved && session.videoId === saved.videoId && session.accountKey === account) { saved.position = session.position; lastPosition = session.position; rememberTrack(); }
        }).catch(() => undefined)
        : Promise.resolve();
      void capture.then(() => pendingWrites()).finally(() => { quitReady = true; app.quit(); });
    });
    app.on('will-quit', () => { updater.dispose(); shortcut.dispose(); tray.destroy(); ytm.dispose(); });
    updater.start();

    window.win.once('ready-to-show', () => {
      const quiet = process.argv.includes('--startup') && prefs.value.quietStartup;
      if (!quiet) window.show();
      setTimeout(() => window.preloadDrawer(), 1500);
    });

    loadRenderer(shell);
    ytm.load();
  });

  app.on('window-all-closed', () => app.quit());
}

main();
