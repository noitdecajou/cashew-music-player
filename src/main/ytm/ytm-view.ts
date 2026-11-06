import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type IpcMainEvent, WebContentsView, app, ipcMain, net, session } from 'electron';
import { OP_RESULTS, type OpMap, type OpName } from '../../shared/ops';
import { type AgentMessage, type PlayerCommand, sanitizeAgentMessage } from '../../shared/player';

export const YTM_ORIGIN = 'https://music.youtube.com';
export const YTM_HOME = `${YTM_ORIGIN}/`;
const PARTITION = 'persist:music'; // same as 1.x: keeps the user signed in

const ALLOWED_HOSTS = new Set([
  'music.youtube.com', 'accounts.google.com', 'accounts.youtube.com',
  'consent.youtube.com', 'consent.google.com', 'www.youtube.com',
]);

export function isAllowedNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (ALLOWED_HOSTS.has(url.hostname) || /^accounts\.google\.[a-z.]+$/.test(url.hostname));
  } catch {
    return false;
  }
}

/** Test-only: serve a fake music.youtube.com page. Never active in a packaged app. */
function installFixture(target: Electron.Session): void {
  const fixture = process.env.MP_YTM_FIXTURE;
  if (!fixture || app.isPackaged) return;
  const delay = Number(process.env.MP_YTM_FIXTURE_DELAY) || 0;
  target.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.hostname === 'music.youtube.com') {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return new Response(readFileSync(fixture), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.hostname === 'i.ytimg.com' || url.hostname === 'lh3.googleusercontent.com') return new Response('', { status: 404 });
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

export class YtmView {
  readonly view: WebContentsView;
  private readonly listeners = new Set<(message: AgentMessage) => void>();
  private ready = false;
  private nextOpId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(onBlockedNavigation: (host: string) => void) {
    const music = session.fromPartition(PARTITION);
    installFixture(music);
    // Only what playback needs. Everything else (notifications, geolocation...) is refused.
    music.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['fullscreen', 'media', 'clipboard-sanitized-write'].includes(permission));
    });

    this.view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        preload: join(__dirname, '../preload/ytm.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Playback continues while the view is detached in mini mode.
        backgroundThrottling: false,
      },
    });
    const contents = this.view.webContents;

    const guard = (event: Electron.Event, url: string): void => {
      if (isAllowedNavigation(url)) return;
      event.preventDefault();
      try { onBlockedNavigation(new URL(url).hostname); } catch { onBlockedNavigation('?'); }
    };
    contents.on('will-navigate', event => guard(event, event.url));
    contents.on('will-redirect', event => guard(event, event.url));
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url)) void contents.loadURL(url);
      return { action: 'deny' };
    });
    contents.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isSameDocument) {
        this.ready = false;
        this.failPending('YouTube Music a été rechargé. Réessaie.');
      }
    });

    ipcMain.on('ytm:message', this.onMessage);
  }

  private readonly onMessage = (event: IpcMainEvent, raw: unknown): void => {
    const contents = this.view.webContents;
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    if (!contents.getURL().startsWith(YTM_ORIGIN + '/')) return;
    const message = sanitizeAgentMessage(raw);
    if (!message) return;
    if (message.kind === 'ready') this.ready = true;
    if (message.kind === 'op-result') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value); else entry.reject(new Error(message.error || 'Opération impossible.'));
      return;
    }
    for (const listener of this.listeners) listener(message);
  };

  subscribe(listener: (message: AgentMessage) => void): void {
    this.listeners.add(listener);
  }

  get isReady(): boolean { return this.ready; }

  send(command: PlayerCommand): void {
    const contents = this.view.webContents;
    if (!contents.isDestroyed()) contents.send('ytm:command', command);
  }

  /** Asks the page agent to run an operation; its result is validated here. */
  async request<K extends OpName>(op: K, payload: OpMap[K]['payload'], timeoutMs = 25000): Promise<OpMap[K]['result']> {
    if (!this.view.webContents.getURL().startsWith(YTM_ORIGIN + '/')) throw new Error('Connecte-toi à YouTube Music dans le grand lecteur.');
    const id = this.nextOpId++;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('YouTube Music ne répond pas. Réessaie dans quelques secondes.')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: 'op', id, op, payload });
    });
    return OP_RESULTS[op](raw) as OpMap[K]['result'];
  }

  private failPending(message: string): void {
    for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error(message)); this.pending.delete(id); }
  }

  load(): void { void this.view.webContents.loadURL(YTM_HOME); }
  reload(): void { this.view.webContents.reload(); }

  dispose(): void {
    this.failPending('Fermeture.');
    ipcMain.removeListener('ytm:message', this.onMessage);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
